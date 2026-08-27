import { InMemorySettlementOutboxStore } from "../repositories/settlementOutboxRepository";
import {
  OUTBOX_BASE_RETRY_MS,
  OUTBOX_MAX_RETRY_MS,
  SettlementOutboxService,
  retryDelay,
} from "./settlementOutboxService";

const now = new Date("2026-08-27T10:00:00.000Z");
const effect = {
  eventKey: "settlement:stream-1:ledger-42",
  eventType: "settlement.completed",
  aggregateId: "stream-1",
  payload: { amount: "12.50", ledger: 42 },
};

describe("retryDelay", () => {
  it("starts at the bounded base delay", () =>
    expect(retryDelay(1)).toBe(OUTBOX_BASE_RETRY_MS));
  it("doubles between attempts", () => {
    expect(retryDelay(2)).toBe(OUTBOX_BASE_RETRY_MS * 2);
    expect(retryDelay(3)).toBe(OUTBOX_BASE_RETRY_MS * 4);
  });
  it("caps runaway backoff", () =>
    expect(retryDelay(100)).toBe(OUTBOX_MAX_RETRY_MS));
  it("normalizes zero and negative attempts", () =>
    expect(retryDelay(0)).toBe(OUTBOX_BASE_RETRY_MS));
});

describe("SettlementOutboxService", () => {
  function setup(handler?: (event: unknown) => Promise<void>) {
    const store = new InMemorySettlementOutboxStore();
    const service = new SettlementOutboxService(
      store,
      new Map(handler ? [[effect.eventType, handler]] : []),
      () => now,
    );
    return { store, service };
  }

  it("persists an event before asynchronous delivery", async () => {
    const { store, service } = setup(async () => undefined);
    const row = await service.enqueue(effect);
    expect(row.status).toBe("pending");
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        eventKey: effect.eventKey,
        eventType: effect.eventType,
        aggregateId: effect.aggregateId,
        payload: effect.payload,
      }),
    ]);
  });

  it("deduplicates a retried settlement transaction by event key", async () => {
    const { store, service } = setup(async () => undefined);
    const first = await service.enqueue(effect);
    const second = await service.enqueue(effect);
    expect(second.id).toBe(first.id);
    expect(store.snapshot()).toHaveLength(1);
  });

  it("delivers a claimed event exactly once and marks it succeeded", async () => {
    const handler = jest.fn(async () => undefined);
    const { store, service } = setup(handler);
    await service.enqueue(effect);
    const summary = await service.processDue();
    expect(summary).toEqual({ succeeded: 1, retried: 0, dead: 0, skipped: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.snapshot()[0]).toEqual(
      expect.objectContaining({ status: "succeeded", attempts: 1 }),
    );
    expect(await service.processDue()).toEqual({
      succeeded: 0,
      retried: 0,
      dead: 0,
      skipped: 0,
    });
  });

  it("retries a transient handler failure with a future availability time", async () => {
    const handler = jest
      .fn()
      .mockRejectedValue(new Error("temporary payout timeout"));
    const { store, service } = setup(handler);
    await service.enqueue(effect);
    expect(await service.processDue()).toEqual({
      succeeded: 0,
      retried: 1,
      dead: 0,
      skipped: 0,
    });
    expect(store.snapshot()[0]).toEqual(
      expect.objectContaining({
        status: "pending",
        attempts: 1,
        lastError: "temporary payout timeout",
      }),
    );
  });

  it("moves a poison event to dead instead of blocking other events", async () => {
    const store = new InMemorySettlementOutboxStore();
    const handler = jest
      .fn()
      .mockRejectedValue(new Error("invalid settlement payload"));
    const service = new SettlementOutboxService(
      store,
      new Map([[effect.eventType, handler]]),
      () => now,
    );
    await service.enqueue({ ...effect, maxAttempts: 1 });
    await service.enqueue({
      ...effect,
      eventKey: "settlement:stream-2:ledger-43",
      aggregateId: "stream-2",
    });
    const summary = await service.processDue(10);
    expect(summary.dead).toBe(1);
    expect(summary.retried).toBe(1);
    expect(store.snapshot().map((row) => row.status)).toEqual([
      "dead",
      "pending",
    ]);
  });

  it("does not let a stale lease acknowledge another worker's claim", async () => {
    const store = new InMemorySettlementOutboxStore();
    const first = new SettlementOutboxService(
      store,
      new Map([[effect.eventType, async () => undefined]]),
      () => now,
    );
    await first.enqueue(effect);
    const firstClaim = await store.claimDue(1, 1_000, now);
    const secondClaim = await store.claimDue(
      1,
      1_000,
      new Date(now.getTime() + 2_000),
    );
    expect(
      await store.markSucceeded(firstClaim[0].id, firstClaim[0].leaseToken),
    ).toBe(false);
    expect(
      await store.markSucceeded(secondClaim[0].id, secondClaim[0].leaseToken),
    ).toBe(true);
  });

  it.each([
    ["blank event key", { ...effect, eventKey: " " }],
    ["blank type", { ...effect, eventType: "" }],
    ["blank aggregate", { ...effect, aggregateId: "" }],
  ])("rejects %s", async (_label, invalid) => {
    const { service } = setup(async () => undefined);
    await expect(service.enqueue(invalid)).rejects.toThrow();
  });

  it("dead-letters an event with no registered handler", async () => {
    const { store, service } = setup();
    await service.enqueue(effect);
    expect(await service.processDue()).toEqual({
      succeeded: 0,
      retried: 0,
      dead: 1,
      skipped: 0,
    });
    expect(store.snapshot()[0].lastError).toContain("No handler");
  });

  it("bounds a worker batch while preserving pending work", async () => {
    const handler = jest.fn(async () => undefined);
    const { store, service } = setup(handler);
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        service.enqueue({
          ...effect,
          eventKey: `settlement:stream-${index}:ledger-1`,
          aggregateId: `stream-${index}`,
        }),
      ),
    );
    expect((await service.processDue(2)).succeeded).toBe(2);
    expect(
      store.snapshot().filter((row) => row.status === "pending"),
    ).toHaveLength(1);
  });
});
