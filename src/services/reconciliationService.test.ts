import {
  CONFIRMATION_PHRASE,
  InMemoryCheckpointStore,
  InMemoryReconciliationSource,
  ReconciliationInputError,
  ReconciliationService,
  compareAmounts,
  formatDecimal,
  makeOperationKey,
  normalizeOptions,
  parseCliArgs,
  parseDecimal,
} from "./reconciliationService";

const records = [
  { id: "stream-1", expectedAmount: "10", actualAmount: "10" },
  { id: "stream-2", expectedAmount: "10.000000001", actualAmount: "10" },
  {
    id: "stream-3",
    expectedAmount: "4.25",
    actualAmount: "6.75",
    status: "active",
  },
  { id: "stream-4", expectedAmount: "0", actualAmount: "0.000000001" },
];

describe("decimal reconciliation arithmetic", () => {
  it.each([
    ["0", 0n],
    ["1", 1_000_000_000n],
    ["1.2", 1_200_000_000n],
    ["1.000000001", 1_000_000_001n],
  ])("parses %s exactly", (input, expected) =>
    expect(parseDecimal(input, "amount")).toBe(expected),
  );

  it("rejects signs, exponent notation, and excessive precision", () => {
    for (const input of ["-1", "+1", "1e3", "1.1234567890", "", ".5"]) {
      expect(() => parseDecimal(input, "amount")).toThrow(
        ReconciliationInputError,
      );
    }
  });

  it.each([
    [0n, "0"],
    [1_000_000_001n, "1.000000001"],
    [-2_500_000_000n, "-2.5"],
  ])("formats exact units", (units, expected) =>
    expect(formatDecimal(units)).toBe(expected),
  );

  it("returns a signed exact difference or null", () => {
    expect(compareAmounts("10.000000001", "10")).toBe("-0.000000001");
    expect(compareAmounts("10", "10.000000001")).toBe("0.000000001");
    expect(compareAmounts("2", "2.000000000")).toBeNull();
  });

  it("creates stable operation keys", () => {
    expect(makeOperationKey("job-a", "stream-1")).toBe(
      "reconciliation:job-a:stream-1",
    );
  });
});

describe("reconciliation safety options", () => {
  it("defaults to dry-run", () =>
    expect(normalizeOptions({ jobId: "job", mode: "dry-run" }).batchSize).toBe(
      100,
    ));
  it("requires an exact confirmation phrase before writes", () => {
    expect(() => normalizeOptions({ jobId: "job", mode: "apply" })).toThrow(
      "confirmation phrase",
    );
    expect(() =>
      normalizeOptions({
        jobId: "job",
        mode: "apply",
        confirmation: "apply-reconciliation",
      }),
    ).toThrow();
    expect(
      normalizeOptions({
        jobId: "job",
        mode: "apply",
        confirmation: CONFIRMATION_PHRASE,
      }).mode,
    ).toBe("apply");
  });

  it("bounds batch sizes", () => {
    expect(() =>
      normalizeOptions({ jobId: "job", mode: "dry-run", batchSize: 0 }),
    ).toThrow();
    expect(() =>
      normalizeOptions({ jobId: "job", mode: "dry-run", batchSize: 1001 }),
    ).toThrow();
    expect(() =>
      normalizeOptions({ jobId: "job", mode: "dry-run", batchSize: 1.5 }),
    ).toThrow();
  });

  it("parses explicit CLI flags", () => {
    expect(
      parseCliArgs([
        "--apply",
        "--confirm",
        CONFIRMATION_PHRASE,
        "--job",
        "nightly",
        "--batch-size",
        "25",
        "--max-batches",
        "3",
        "--input",
        "rows.json",
        "--checkpoint",
        "cp.json",
      ]),
    ).toEqual({
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
      jobId: "nightly",
      batchSize: 25,
      inputPath: "rows.json",
      checkpointPath: "cp.json",
      startOver: false,
      maxBatches: 3,
    });
  });

  it("rejects unknown CLI flags", () =>
    expect(() => parseCliArgs(["--unsafe-write"])).toThrow());
});

describe("ReconciliationService dry-run", () => {
  it("never calls the write adapter", async () => {
    const source = new InMemoryReconciliationSource(records);
    const service = new ReconciliationService(
      source,
      new InMemoryCheckpointStore(),
    );
    const result = await service.run({
      jobId: "dry",
      mode: "dry-run",
      batchSize: 2,
    });
    expect(result).toMatchObject({
      mode: "dry-run",
      scanned: 4,
      mismatches: 3,
      applied: 0,
      complete: true,
    });
    expect(source.applied).toHaveLength(0);
    expect(result.mismatchesFound.map((item) => item.id)).toEqual([
      "stream-2",
      "stream-3",
      "stream-4",
    ]);
  });

  it("can stop after a bounded number of batches without claiming completion", async () => {
    const source = new InMemoryReconciliationSource(records);
    const checkpoints = new InMemoryCheckpointStore();
    const service = new ReconciliationService(source, checkpoints);
    const result = await service.run({
      jobId: "partial",
      mode: "dry-run",
      batchSize: 2,
      maxBatches: 1,
    });
    expect(result.complete).toBe(false);
    expect(result.nextCursor).toBe("2");
    expect(result.scanned).toBe(2);
    expect((await checkpoints.load("partial"))?.nextCursor).toBe("2");
  });
});

describe("ReconciliationService apply and resume", () => {
  it("applies each mismatch once and checkpoints after writes", async () => {
    const source = new InMemoryReconciliationSource(records);
    const service = new ReconciliationService(
      source,
      new InMemoryCheckpointStore(),
    );
    const result = await service.run({
      jobId: "apply",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
      batchSize: 2,
    });
    expect(result).toMatchObject({ applied: 3, skipped: 0, complete: true });
    expect(source.applied.map((item) => item.operationKey)).toEqual([
      "reconciliation:apply:stream-2",
      "reconciliation:apply:stream-3",
      "reconciliation:apply:stream-4",
    ]);
  });

  it("resumes after an interruption instead of restarting at zero", async () => {
    const checkpoints = new InMemoryCheckpointStore();
    const interruptedSource = new InMemoryReconciliationSource(records, 2);
    const interrupted = new ReconciliationService(
      interruptedSource,
      checkpoints,
    );
    await expect(
      interrupted.run({
        jobId: "resume",
        mode: "apply",
        confirmation: CONFIRMATION_PHRASE,
        batchSize: 4,
      }),
    ).rejects.toThrow("interruption");
    expect((await checkpoints.load("resume"))?.processedIds).toEqual([
      "stream-2",
    ]);

    const resumedSource = new InMemoryReconciliationSource(records);
    const resumed = new ReconciliationService(resumedSource, checkpoints);
    const result = await resumed.run({
      jobId: "resume",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
      batchSize: 4,
    });
    expect(result.complete).toBe(true);
    expect(result.applied).toBe(2);
    expect(resumedSource.applied.map((item) => item.id)).toEqual([
      "stream-3",
      "stream-4",
    ]);
  });

  it("skips already checkpointed operations on a rerun", async () => {
    const source = new InMemoryReconciliationSource(records);
    const checkpoints = new InMemoryCheckpointStore();
    const service = new ReconciliationService(source, checkpoints);
    await service.run({
      jobId: "rerun",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
    });
    const second = await service.run({
      jobId: "rerun",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
    });
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(3);
  });

  it("supports a deliberate start-over", async () => {
    const source = new InMemoryReconciliationSource(records);
    const checkpoints = new InMemoryCheckpointStore();
    const service = new ReconciliationService(source, checkpoints);
    await service.run({
      jobId: "reset",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
    });
    const second = await service.run({
      jobId: "reset",
      mode: "apply",
      confirmation: CONFIRMATION_PHRASE,
      startOver: true,
    });
    expect(second.applied).toBe(3);
  });

  it("rejects malformed source records before applying them", async () => {
    const source = new InMemoryReconciliationSource([
      { id: "bad", expectedAmount: "1e3", actualAmount: "1000" },
    ]);
    const service = new ReconciliationService(
      source,
      new InMemoryCheckpointStore(),
    );
    await expect(
      service.run({
        jobId: "bad",
        mode: "apply",
        confirmation: CONFIRMATION_PHRASE,
      }),
    ).rejects.toThrow("decimal");
    expect(source.applied).toHaveLength(0);
  });
});
