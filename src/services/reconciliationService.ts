/**
 * Safe, resumable reconciliation primitives.
 *
 * The runner deliberately knows nothing about SQL. A production adapter can
 * read and write streams, invoices, or ledger entries; tests can use a small
 * in-memory adapter. This keeps the safety rules identical in a CLI and in a
 * scheduled worker.
 */

export type ReconciliationRecord = {
  id: string;
  expectedAmount: string;
  actualAmount: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export type ReconciliationMismatch = ReconciliationRecord & {
  difference: string;
  operationKey: string;
};

export type ReconciliationCheckpoint = {
  jobId: string;
  nextCursor: string | null;
  processedIds: string[];
  scanned: number;
  mismatches: number;
  updatedAt: string;
};

export type ReconciliationBatch = {
  records: ReconciliationRecord[];
  nextCursor: string | null;
};

export interface ReconciliationSource {
  readBatch(
    cursor: string | null,
    batchSize: number,
  ): Promise<ReconciliationBatch>;
  /** Must be idempotent for operationKey; repeat calls must not duplicate a correction. */
  applyMismatch(mismatch: ReconciliationMismatch): Promise<void>;
}

export interface ReconciliationCheckpointStore {
  load(jobId: string): Promise<ReconciliationCheckpoint | null>;
  save(checkpoint: ReconciliationCheckpoint): Promise<void>;
}

export type ReconciliationMode = "dry-run" | "apply";

export type ReconciliationOptions = {
  jobId: string;
  mode: ReconciliationMode;
  confirmation?: string;
  expectedConfirmation?: string;
  batchSize?: number;
  startOver?: boolean;
  maxBatches?: number;
};

export type ReconciliationResult = {
  mode: ReconciliationMode;
  scanned: number;
  mismatches: number;
  applied: number;
  skipped: number;
  nextCursor: string | null;
  complete: boolean;
  mismatchesFound: ReconciliationMismatch[];
};

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 1_000;
export const CONFIRMATION_PHRASE = "APPLY-RECONCILIATION";

export class ReconciliationInputError extends Error {}

export function parseDecimal(value: string, fieldName: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) {
    throw new ReconciliationInputError(
      `${fieldName} must be a non-negative decimal with up to 9 places`,
    );
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

export function formatDecimal(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const whole = absolute / 1_000_000_000n;
  const fraction = (absolute % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function compareAmounts(
  expected: string,
  actual: string,
): string | null {
  const expectedUnits = parseDecimal(expected, "expectedAmount");
  const actualUnits = parseDecimal(actual, "actualAmount");
  const difference = actualUnits - expectedUnits;
  return difference === 0n ? null : formatDecimal(difference);
}

export function makeOperationKey(jobId: string, recordId: string): string {
  return `reconciliation:${jobId}:${recordId}`;
}

export function normalizeOptions(
  options: ReconciliationOptions,
): Required<ReconciliationOptions> {
  if (!options.jobId.trim())
    throw new ReconciliationInputError("jobId is required");
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new ReconciliationInputError(
      `batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`,
    );
  }
  const expectedConfirmation =
    options.expectedConfirmation ?? CONFIRMATION_PHRASE;
  if (
    options.mode === "apply" &&
    options.confirmation !== expectedConfirmation
  ) {
    throw new ReconciliationInputError(
      `apply mode requires confirmation phrase ${expectedConfirmation}`,
    );
  }
  return {
    jobId: options.jobId,
    mode: options.mode,
    confirmation: options.confirmation ?? "",
    expectedConfirmation,
    batchSize,
    startOver: options.startOver ?? false,
    maxBatches: options.maxBatches ?? Number.POSITIVE_INFINITY,
  };
}

export class ReconciliationService {
  constructor(
    private readonly source: ReconciliationSource,
    private readonly checkpoints: ReconciliationCheckpointStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(options: ReconciliationOptions): Promise<ReconciliationResult> {
    const config = normalizeOptions(options);
    const previous = config.startOver
      ? null
      : await this.checkpoints.load(config.jobId);
    let checkpoint = previous ?? {
      jobId: config.jobId,
      nextCursor: null,
      processedIds: [],
      scanned: 0,
      mismatches: 0,
      updatedAt: this.clock().toISOString(),
    };
    const processed = new Set(checkpoint.processedIds);
    const mismatchesFound: ReconciliationMismatch[] = [];
    let applied = 0;
    let skipped = 0;
    let batches = 0;

    while (batches < config.maxBatches) {
      const batch = await this.source.readBatch(
        checkpoint.nextCursor,
        config.batchSize,
      );
      if (batch.records.length > config.batchSize) {
        throw new ReconciliationInputError(
          "source returned more records than requested batch size",
        );
      }
      for (const record of batch.records) {
        if (!record.id.trim())
          throw new ReconciliationInputError(
            "reconciliation record id is required",
          );
        const difference = compareAmounts(
          record.expectedAmount,
          record.actualAmount,
        );
        checkpoint.scanned += 1;
        if (difference === null) continue;
        checkpoint.mismatches += 1;
        const mismatch: ReconciliationMismatch = {
          ...record,
          difference,
          operationKey: makeOperationKey(config.jobId, record.id),
        };
        mismatchesFound.push(mismatch);
        if (config.mode === "dry-run") continue;
        if (processed.has(record.id)) {
          skipped += 1;
          continue;
        }
        await this.source.applyMismatch(mismatch);
        processed.add(record.id);
        applied += 1;
        checkpoint.processedIds = [...processed].sort();
        checkpoint.updatedAt = this.clock().toISOString();
        // Save after each successful write: an interruption loses at most one
        // idempotent operation and never causes the runner to restart at zero.
        await this.checkpoints.save({ ...checkpoint });
      }
      checkpoint.nextCursor = batch.nextCursor;
      checkpoint.updatedAt = this.clock().toISOString();
      await this.checkpoints.save({
        ...checkpoint,
        processedIds: [...processed].sort(),
      });
      batches += 1;
      if (batch.nextCursor === null || batch.records.length === 0) {
        return {
          mode: config.mode,
          scanned: checkpoint.scanned,
          mismatches: checkpoint.mismatches,
          applied,
          skipped,
          nextCursor: null,
          complete: true,
          mismatchesFound,
        };
      }
    }
    return {
      mode: config.mode,
      scanned: checkpoint.scanned,
      mismatches: checkpoint.mismatches,
      applied,
      skipped,
      nextCursor: checkpoint.nextCursor,
      complete: false,
      mismatchesFound,
    };
  }
}

export class InMemoryCheckpointStore implements ReconciliationCheckpointStore {
  private readonly checkpoints = new Map<string, ReconciliationCheckpoint>();

  async load(jobId: string): Promise<ReconciliationCheckpoint | null> {
    const checkpoint = this.checkpoints.get(jobId);
    return checkpoint
      ? { ...checkpoint, processedIds: [...checkpoint.processedIds] }
      : null;
  }

  async save(checkpoint: ReconciliationCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.jobId, {
      ...checkpoint,
      processedIds: [...checkpoint.processedIds],
    });
  }
}

export class InMemoryReconciliationSource implements ReconciliationSource {
  readonly applied: ReconciliationMismatch[] = [];
  private readonly appliedKeys = new Set<string>();

  constructor(
    private readonly records: ReconciliationRecord[],
    private readonly failOnCall?: number,
  ) {}

  async readBatch(
    cursor: string | null,
    batchSize: number,
  ): Promise<ReconciliationBatch> {
    const start = cursor ? Number(cursor) : 0;
    const records = this.records.slice(start, start + batchSize);
    const next = start + records.length;
    return {
      records,
      nextCursor: next < this.records.length ? String(next) : null,
    };
  }

  async applyMismatch(mismatch: ReconciliationMismatch): Promise<void> {
    if (
      this.failOnCall !== undefined &&
      this.applied.length + 1 === this.failOnCall
    ) {
      throw new Error("simulated interruption");
    }
    if (this.appliedKeys.has(mismatch.operationKey)) return;
    this.appliedKeys.add(mismatch.operationKey);
    this.applied.push(mismatch);
  }
}

export function parseCliArgs(
  args: string[],
): ReconciliationOptions & { inputPath: string; checkpointPath: string } {
  let mode: ReconciliationMode = "dry-run";
  let confirmation: string | undefined;
  let jobId = "default-reconciliation";
  let batchSize: number | undefined;
  let inputPath = "reconciliation-input.json";
  let checkpointPath = "reconciliation-checkpoint.json";
  let startOver = false;
  let maxBatches: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--start-over") startOver = true;
    else if (arg === "--confirm") confirmation = args[++index];
    else if (arg === "--job") jobId = args[++index] ?? "";
    else if (arg === "--batch-size") batchSize = Number(args[++index]);
    else if (arg === "--input") inputPath = args[++index] ?? "";
    else if (arg === "--checkpoint") checkpointPath = args[++index] ?? "";
    else if (arg === "--max-batches") maxBatches = Number(args[++index]);
    else throw new ReconciliationInputError(`unknown argument ${arg}`);
  }
  return {
    jobId,
    mode,
    confirmation,
    batchSize,
    startOver,
    maxBatches,
    inputPath,
    checkpointPath,
  };
}
