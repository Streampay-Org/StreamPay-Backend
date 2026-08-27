import { InMemoryProcessedIndexerEventStore } from "./processedIndexerEventRepository";

describe("InMemoryProcessedIndexerEventStore", () => {
  it("claims a new immutable event exactly once", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "in_progress" });
  });

  it("marks a claimed event completed and makes an exact replay harmless", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.complete("evt-1");

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
    await store.complete("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
  });

  it("rejects a conflicting payload for a completed event", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.complete("evt-1");

    expect(await store.claim("evt-1", "hash-2")).toEqual({ kind: "conflict" });
  });

  it("rejects a conflicting payload while the original event is processing", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");

    expect(await store.claim("evt-1", "hash-2")).toEqual({ kind: "conflict" });
  });

  it("allows a failed settlement to be claimed again", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.fail("evt-1");

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "in_progress" });
  });

  it("keeps independent event ids isolated", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    expect(await store.claim("evt-a", "same-hash")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-b", "same-hash")).toEqual({ kind: "claimed" });
    await store.complete("evt-a");

    expect(await store.claim("evt-a", "same-hash")).toEqual({ kind: "duplicate" });
    expect(await store.claim("evt-b", "same-hash")).toEqual({ kind: "in_progress" });
  });

  it("keeps the event identity bound when completion is called for another id", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-a", "hash-a");
    await store.complete("evt-b");

    expect(await store.claim("evt-a", "hash-a")).toEqual({ kind: "in_progress" });
    expect(await store.claim("evt-b", "hash-b")).toEqual({ kind: "claimed" });
  });

  it("keeps the event identity bound when failure is called for another id", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-a", "hash-a");
    await store.fail("evt-b");

    expect(await store.claim("evt-a", "hash-a")).toEqual({ kind: "in_progress" });
    expect(await store.claim("evt-b", "hash-b")).toEqual({ kind: "claimed" });
  });

  it("supports a clean retry after a failed attempt completes", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    await store.fail("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    await store.complete("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
  });

  it("does not make an unrelated failure reusable for a different fingerprint", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.fail("evt-1");

    expect(await store.claim("evt-1", "hash-2")).toEqual({ kind: "conflict" });
  });

  it("returns one initial claim and active state for concurrent requests", async () => {
    const store = new InMemoryProcessedIndexerEventStore();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.claim("evt-concurrent", "hash-concurrent")),
    );

    expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "in_progress")).toHaveLength(19);
  });

  it("allows only the same fingerprint to retry after failure", async () => {
    const store = new InMemoryProcessedIndexerEventStore();
    const eventId = "evt-retry";

    await store.claim(eventId, "original");
    await store.fail(eventId);
    expect(await store.claim(eventId, "changed")).toEqual({ kind: "conflict" });
    expect(await store.claim(eventId, "original")).toEqual({ kind: "claimed" });
  });

  it("resets all event state for a controlled test or service reset", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.complete("evt-1");
    await store.claim("evt-2", "hash-2");
    await store.reset();

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-2", "hash-2")).toEqual({ kind: "claimed" });
  });

  it("does not confuse event ids that are prefixes of one another", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt", "hash-1");
    await store.complete("evt");
    expect(await store.claim("evt-extended", "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt", "hash-1")).toEqual({ kind: "duplicate" });
  });

  it("does not confuse fingerprints that are prefixes of one another", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt", "hash");
    await store.complete("evt");
    expect(await store.claim("evt", "hash-extended")).toEqual({ kind: "conflict" });
  });

  it("keeps multiple failed events independently retryable", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-a", "hash-a");
    await store.claim("evt-b", "hash-b");
    await store.fail("evt-a");
    await store.complete("evt-b");

    expect(await store.claim("evt-a", "hash-a")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-b", "hash-b")).toEqual({ kind: "duplicate" });
  });

  it("does not create state when completing or failing an unknown event", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.complete("unknown");
    await store.fail("unknown");

    expect(await store.claim("unknown", "hash-unknown")).toEqual({ kind: "claimed" });
  });

  it("does not let completion turn an active event into a new claim", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.complete("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
  });

  it("does not let failure turn an active event into a duplicate", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.fail("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
  });

  it("preserves a failed event fingerprint across repeated failures", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.fail("evt-1");
    await store.fail("evt-1");

    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim("evt-1", "hash-2")).toEqual({ kind: "conflict" });
  });

  it("allows separate concurrent event ids to make progress independently", async () => {
    const store = new InMemoryProcessedIndexerEventStore();
    const results = await Promise.all([
      store.claim("evt-a", "hash-a"),
      store.claim("evt-b", "hash-b"),
      store.claim("evt-c", "hash-c"),
    ]);

    expect(results).toEqual([
      { kind: "claimed" },
      { kind: "claimed" },
      { kind: "claimed" },
    ]);
  });

  it("keeps an event in progress until explicit completion", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "in_progress" });
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "in_progress" });
    await store.complete("evt-1");
    expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
  });

  it("keeps a completed event permanently replay-safe until reset", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "hash-1");
    await store.complete("evt-1");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await store.claim("evt-1", "hash-1")).toEqual({ kind: "duplicate" });
    }
  });

  it("binds each retry to the entire fingerprint string", async () => {
    const store = new InMemoryProcessedIndexerEventStore();

    await store.claim("evt-1", "a".repeat(64));
    await store.complete("evt-1");
    expect(await store.claim("evt-1", "a".repeat(63))).toEqual({ kind: "conflict" });
    expect(await store.claim("evt-1", "a".repeat(64))).toEqual({ kind: "duplicate" });
  });

  it("does not share state between separate store instances", async () => {
    const firstStore = new InMemoryProcessedIndexerEventStore();
    const restartedStore = new InMemoryProcessedIndexerEventStore();

    await firstStore.claim("evt-1", "hash-1");
    await firstStore.complete("evt-1");

    expect(await restartedStore.claim("evt-1", "hash-1")).toEqual({ kind: "claimed" });
  });

  it("distinguishes all state outcomes for one stable event identity", async () => {
    const store = new InMemoryProcessedIndexerEventStore();
    const eventId = "evt-state-machine";

    expect(await store.claim(eventId, "hash-1")).toEqual({ kind: "claimed" });
    expect(await store.claim(eventId, "hash-1")).toEqual({ kind: "in_progress" });
    expect(await store.claim(eventId, "hash-2")).toEqual({ kind: "conflict" });
    await store.fail(eventId);
    expect(await store.claim(eventId, "hash-1")).toEqual({ kind: "claimed" });
    await store.complete(eventId);
    expect(await store.claim(eventId, "hash-1")).toEqual({ kind: "duplicate" });
    expect(await store.claim(eventId, "hash-2")).toEqual({ kind: "conflict" });
  });
});
