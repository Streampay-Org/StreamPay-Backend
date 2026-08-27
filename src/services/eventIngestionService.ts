import crypto from "crypto";
import {
  InMemoryProcessedIndexerEventStore,
  ProcessedIndexerEventRepository,
  type ProcessedIndexerEventStore,
} from "../repositories/processedIndexerEventRepository";
import {
  InMemoryMeteringCheckpointStore,
  MeteringCheckpointRepository,
  type MeteringCheckpointStore,
} from "../repositories/meteringCheckpointRepository";

export type IndexerEventPayload = {
  eventId: string;
  eventType: string;
  streamId: string;
  occurredAt: string;
  chainId?: string;
  transactionHash?: string;
  sequence?: number;
  data?: Record<string, unknown>;
};

export type IngestionSuccessResult = {
  accepted: true;
  duplicate: boolean;
  event: IndexerEventPayload;
};

export type IngestionFailureCode =
  | "missing_secret"
  | "invalid_signature"
  | "invalid_json"
  | "invalid_payload"
  | "idempotency_unavailable"
  | "metering_gap"
  | "late_metering_event"
  | "idempotency_conflict"
  | "settlement_in_progress";

export type IngestionFailureResult = {
  accepted: false;
  code: IngestionFailureCode;
  message: string;
};

export type IngestionResult = IngestionSuccessResult | IngestionFailureResult;

const SIGNATURE_PREFIX = "sha256=";

export class EventIngestionService {
  constructor(
    private readonly processedEvents: ProcessedIndexerEventStore,
    private readonly meteringCheckpoints: MeteringCheckpointStore = createDefaultMeteringCheckpointStore(),
  ) {}

  async ingest(rawBody: Buffer, signatureHeader: string | undefined): Promise<IngestionResult> {
    const secret = process.env.INDEXER_WEBHOOK_SECRET;

    if (!secret) {
      return {
        accepted: false,
        code: "missing_secret",
        message: "Indexer webhook secret is not configured.",
      };
    }

    if (!signatureHeader || !this.isValidSignature(rawBody, signatureHeader, secret)) {
      return {
        accepted: false,
        code: "invalid_signature",
        message: "Webhook signature verification failed.",
      };
    }

    let payload: unknown;

    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return {
        accepted: false,
        code: "invalid_json",
        message: "Webhook payload must be valid JSON.",
      };
    }

    const event = this.parsePayload(payload);
    if (!event) {
      return {
        accepted: false,
        code: "invalid_payload",
        message: "Webhook payload is missing one or more required fields.",
      };
    }

    if (isMeteringEvent(event.eventType)) {
      if (event.sequence === undefined) {
        return {
          accepted: false,
          code: "invalid_payload",
          message: "Metering events require a positive integer sequence.",
        };
      }

      let checkpoint: Awaited<ReturnType<MeteringCheckpointStore["apply"]>>;
      try {
        checkpoint = await this.meteringCheckpoints.apply(event.streamId, event.eventId, event.sequence);
      } catch {
        return {
          accepted: false,
          code: "idempotency_unavailable",
          message: "Metering checkpoint storage is unavailable.",
        };
      }

      if (checkpoint.kind === "gap" || checkpoint.kind === "gap_too_large") {
        return {
          accepted: false,
          code: "metering_gap",
          message: `Metering sequence gap: expected ${checkpoint.expectedSequence}, received ${checkpoint.receivedSequence}.`,
        };
      }
      if (checkpoint.kind === "late") {
        return {
          accepted: false,
          code: "late_metering_event",
          message: `Late metering event rejected at checkpoint ${checkpoint.checkpoint}.`,
        };
      }

      return {
        accepted: true,
        duplicate: checkpoint.kind === "duplicate",
        event,
      };
    }

    const fingerprint = fingerprintEvent(event);
    let claim: Awaited<ReturnType<ProcessedIndexerEventStore["claim"]>>;
    try {
      claim = await this.processedEvents.claim(event.eventId, fingerprint);
    } catch {
      return {
        accepted: false,
        code: "idempotency_unavailable",
        message: "Webhook replay protection is unavailable.",
      };
    }

    if (claim.kind === "conflict") {
      return {
        accepted: false,
        code: "idempotency_conflict",
        message: "The event id is already bound to a different payload.",
      };
    }

    if (claim.kind === "in_progress") {
      return {
        accepted: false,
        code: "settlement_in_progress",
        message: "Settlement for this event is already being processed.",
      };
    }

    if (claim.kind === "claimed") {
      try {
        await this.processedEvents.complete(event.eventId);
      } catch {
        await this.processedEvents.fail(event.eventId).catch(() => undefined);
        return {
          accepted: false,
          code: "idempotency_unavailable",
          message: "Webhook replay protection is unavailable.",
        };
      }
    }

    return {
      accepted: true,
      duplicate: claim.kind === "duplicate",
      event,
    };
  }

  async reset(): Promise<void> {
    await this.processedEvents.reset();
    await this.meteringCheckpoints.reset();
  }

  private isValidSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
    const incomingSignature = signatureHeader.startsWith(SIGNATURE_PREFIX)
      ? signatureHeader.slice(SIGNATURE_PREFIX.length)
      : signatureHeader;

    const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(incomingSignature, "hex");

    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  private parsePayload(payload: unknown): IndexerEventPayload | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const candidate = payload as Record<string, unknown>;
    const requiredKeys = ["eventId", "eventType", "streamId", "occurredAt"] as const;
    const hasRequiredStrings = requiredKeys.every((key) => typeof candidate[key] === "string" && candidate[key]);

    if (!hasRequiredStrings) {
      return null;
    }

    return {
      eventId: candidate.eventId as string,
      eventType: candidate.eventType as string,
      streamId: candidate.streamId as string,
      occurredAt: candidate.occurredAt as string,
      chainId: typeof candidate.chainId === "string" ? candidate.chainId : undefined,
      transactionHash: typeof candidate.transactionHash === "string" ? candidate.transactionHash : undefined,
      sequence: this.parseSequence(candidate.sequence),
      data: this.isRecord(candidate.data) ? candidate.data : undefined,
    };
  }

  private parseSequence(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

/**
 * Produce a stable identity for the complete parsed event rather than relying
 * on raw JSON property order. This binds retries to the same business payload
 * while still allowing semantically equivalent JSON bodies to replay safely.
 */
function fingerprintEvent(event: IndexerEventPayload): string {
  return crypto.createHash("sha256").update(canonicalize(event)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
}

function createDefaultReplayStore(): ProcessedIndexerEventStore {
  if (process.env.NODE_ENV === "test") {
    return new InMemoryProcessedIndexerEventStore();
  }
  return new ProcessedIndexerEventRepository();
}

function createDefaultMeteringCheckpointStore(): MeteringCheckpointStore {
  if (process.env.NODE_ENV === "test") {
    return new InMemoryMeteringCheckpointStore();
  }
  return new MeteringCheckpointRepository();
}

function isMeteringEvent(eventType: string): boolean {
  return eventType === "metering" || eventType === "metered" || eventType === "usage_recorded";
}

export const eventIngestionService = new EventIngestionService(createDefaultReplayStore());
