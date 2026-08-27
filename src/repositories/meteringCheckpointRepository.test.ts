import { InMemoryMeteringCheckpointStore, MAX_METERING_GAP } from "./meteringCheckpointRepository";

describe("InMemoryMeteringCheckpointStore", () => {
  it("starts every stream at sequence one", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-1", "event-1", 1)).toEqual({
      kind: "accepted",
      nextSequence: 1,
    });
  });

  it("requires contiguous sequences", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-1", "event-2", 2)).toEqual({
      kind: "gap",
      expectedSequence: 1,
      receivedSequence: 2,
    });
    expect(await store.apply("stream-1", "event-1", 1)).toEqual({
      kind: "accepted",
      nextSequence: 1,
    });
    expect(await store.apply("stream-1", "event-2", 2)).toEqual({
      kind: "accepted",
      nextSequence: 2,
    });
  });

  it("does not record a gap before its missing predecessor arrives", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-1", "event-3", 3);
    expect(await store.apply("stream-1", "event-1", 1)).toEqual({
      kind: "accepted",
      nextSequence: 1,
    });
    expect(await store.apply("stream-1", "event-3", 3)).toEqual({
      kind: "gap",
      expectedSequence: 2,
      receivedSequence: 3,
    });
  });

  it("reports an event behind the checkpoint as late", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-1", "event-1", 1);
    await store.apply("stream-1", "event-2", 2);
    expect(await store.apply("stream-1", "event-late", 1)).toEqual({
      kind: "late",
      checkpoint: 2,
    });
  });

  it("returns duplicate for the same event id even after the checkpoint advances", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-1", "event-1", 1);
    await store.apply("stream-1", "event-2", 2);
    expect(await store.apply("stream-1", "event-1", 1)).toEqual({
      kind: "duplicate",
      nextSequence: 1,
    });
  });

  it("keeps an event id unique across streams", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-a", "event-1", 1);
    expect(await store.apply("stream-b", "event-1", 1)).toEqual({
      kind: "duplicate",
      nextSequence: 1,
    });
  });

  it("allows the same sequence on different streams", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-a", "event-a", 1)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-b", "event-b", 1)).toMatchObject({ kind: "accepted" });
  });

  it("bounds a gap so an adversarial sequence cannot create unbounded recovery state", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-1", "event-far", MAX_METERING_GAP + 2)).toEqual({
      kind: "gap_too_large",
      expectedSequence: 1,
      receivedSequence: MAX_METERING_GAP + 2,
    });
  });

  it("accepts the largest sequence within the bounded gap window only after recovery", async () => {
    const store = new InMemoryMeteringCheckpointStore();
    const last = MAX_METERING_GAP + 1;

    expect(await store.apply("stream-1", "event-far", last)).toEqual({
      kind: "gap",
      expectedSequence: 1,
      receivedSequence: last,
    });
    for (let sequence = 1; sequence <= last; sequence += 1) {
      expect(await store.apply("stream-1", `event-${sequence}`, sequence)).toEqual({
        kind: "accepted",
        nextSequence: sequence,
      });
    }
  });

  it("isolates late events between streams", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-a", "event-a-1", 1);
    await store.apply("stream-a", "event-a-2", 2);
    expect(await store.apply("stream-b", "event-b-1", 1)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-b", "event-b-2", 2)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-a", "event-a-late", 1)).toEqual({
      kind: "late",
      checkpoint: 2,
    });
  });

  it("supports a missing event arriving after multiple independent gaps", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-a", "event-a-3", 3)).toMatchObject({ kind: "gap" });
    expect(await store.apply("stream-b", "event-b-2", 2)).toMatchObject({ kind: "gap" });
    expect(await store.apply("stream-a", "event-a-1", 1)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-a", "event-a-2", 2)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-a", "event-a-3", 3)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-b", "event-b-1", 1)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-b", "event-b-2", 2)).toMatchObject({ kind: "accepted" });
  });

  it("keeps concurrent claims for one stream serialized by the synchronous decision", async () => {
    const store = new InMemoryMeteringCheckpointStore();
    const results = await Promise.all([
      store.apply("stream-1", "event-1", 1),
      store.apply("stream-1", "event-2", 1),
      store.apply("stream-1", "event-3", 1),
    ]);

    expect(results.filter((result) => result.kind === "accepted")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "late")).toHaveLength(2);
  });

  it("resets all stream checkpoints", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-1", "event-1", 1);
    await store.apply("stream-2", "event-1", 1);
    await store.reset();

    expect(await store.apply("stream-1", "event-new-1", 1)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-2", "event-new-2", 1)).toMatchObject({ kind: "accepted" });
  });

  it("does not advance a checkpoint on an out-of-order event", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    await store.apply("stream-1", "event-1", 1);
    await store.apply("stream-1", "event-4", 4);
    expect(await store.apply("stream-1", "event-2", 2)).toMatchObject({ kind: "accepted" });
    expect(await store.apply("stream-1", "event-4", 4)).toEqual({
      kind: "gap",
      expectedSequence: 3,
      receivedSequence: 4,
    });
  });

  it("does not let a duplicate event repair a gap", async () => {
    const store = new InMemoryMeteringCheckpointStore();

    expect(await store.apply("stream-1", "event-2", 2)).toMatchObject({ kind: "gap" });
    expect(await store.apply("stream-1", "event-2", 2)).toMatchObject({ kind: "gap" });
    expect(await store.apply("stream-1", "event-1", 1)).toMatchObject({ kind: "accepted" });
  });
});
