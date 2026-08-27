import crypto from "crypto";

import { EventIngestionService } from "../eventIngestionService";
import type {
  ProcessedIndexerEventClaim,
  ProcessedIndexerEventStore,
} from "../../repositories/processedIndexerEventRepository";
import { InMemoryMeteringCheckpointStore } from "../../repositories/meteringCheckpointRepository";

const secret = "test-indexer-secret";

const payload = {
  eventId: "evt_persistent_123",
  eventType: "settled",
  streamId: "stream_456",
  occurredAt: "2026-03-23T10:00:00.000Z",
};

const meteringPayload = {
  eventId: "evt_metering_1",
  eventType: "metering",
  streamId: "stream_metered",
  occurredAt: "2026-03-23T10:00:00.000Z",
  sequence: 1,
  data: { units: 10 },
};

class FakeProcessedIndexerEventStore implements ProcessedIndexerEventStore {
  readonly events = new Map<string, { fingerprint: string; status: "processing" | "completed" | "failed" }>();
  readonly calls: string[] = [];
  failRecord = false;

  async claim(eventId: string, fingerprint: string): Promise<ProcessedIndexerEventClaim> {
    this.calls.push(eventId);
    if (this.failRecord) {
      throw new Error("database unavailable");
    }
    const existing = this.events.get(eventId);
    if (!existing) {
      this.events.set(eventId, { fingerprint, status: "processing" });
      return { kind: "claimed" };
    }
    if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
    if (existing.status === "completed") return { kind: "duplicate" };
    if (existing.status === "processing") return { kind: "in_progress" };
    existing.status = "processing";
    return { kind: "claimed" };
  }

  async complete(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) event.status = "completed";
  }

  async fail(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) event.status = "failed";
  }

  async reset(): Promise<void> {
    this.events.clear();
    this.calls.length = 0;
  }
}

function sign(body: string): string {
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

describe("EventIngestionService", () => {
  beforeEach(() => {
    process.env.INDEXER_WEBHOOK_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.INDEXER_WEBHOOK_SECRET;
  });

  it("uses the injected event store so duplicates survive fresh service instances", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const body = Buffer.from(JSON.stringify(payload));
    const signature = sign(body.toString("utf8"));

    const firstService = new EventIngestionService(store);
    const first = await firstService.ingest(body, signature);

    const restartedService = new EventIngestionService(store);
    const replay = await restartedService.ingest(body, signature);

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
    expect(store.calls).toEqual([payload.eventId, payload.eventId]);
  });

  it("validates signatures and payloads before recording idempotency", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const service = new EventIngestionService(store);
    const body = Buffer.from(JSON.stringify(payload));

    const result = await service.ingest(body, "sha256=deadbeef");

    expect(result).toMatchObject({ accepted: false, code: "invalid_signature" });
    expect(store.calls).toEqual([]);
  });

  it("fails closed when the persistent replay store is unavailable", async () => {
    const store = new FakeProcessedIndexerEventStore();
    store.failRecord = true;

    const service = new EventIngestionService(store);
    const body = Buffer.from(JSON.stringify(payload));
    const result = await service.ingest(body, sign(body.toString("utf8")));

    expect(result).toEqual({
      accepted: false,
      code: "idempotency_unavailable",
      message: "Webhook replay protection is unavailable.",
    });
  });

  it("rejects a reused event id when the complete payload conflicts", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const service = new EventIngestionService(store);
    const firstBody = Buffer.from(JSON.stringify(payload));
    const conflictingBody = Buffer.from(JSON.stringify({ ...payload, streamId: "stream_other" }));

    const first = await service.ingest(firstBody, sign(firstBody.toString("utf8")));
    const conflict = await service.ingest(conflictingBody, sign(conflictingBody.toString("utf8")));

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(conflict).toEqual({
      accepted: false,
      code: "idempotency_conflict",
      message: "The event id is already bound to a different payload.",
    });
    expect(store.events.get(payload.eventId)?.status).toBe("completed");
  });

  it("reports an active claim instead of allowing a concurrent settlement", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const service = new EventIngestionService(store);
    const body = Buffer.from(JSON.stringify(payload));

    const first = await service.ingest(body, sign(body.toString("utf8")));
    const event = store.events.get(payload.eventId);
    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(event).toBeDefined();
    if (!event) throw new Error("expected the first settlement claim");
    event.status = "processing";

    const concurrent = await service.ingest(body, sign(body.toString("utf8")));
    expect(concurrent).toEqual({
      accepted: false,
      code: "settlement_in_progress",
      message: "Settlement for this event is already being processed.",
    });
  });

  it("allows a failed claim to retry exactly once", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const service = new EventIngestionService(store);
    const body = Buffer.from(JSON.stringify(payload));
    const signature = sign(body.toString("utf8"));

    const initial = await service.ingest(body, signature);
    const event = store.events.get(payload.eventId);
    expect(initial).toMatchObject({ accepted: true, duplicate: false });
    expect(event).toBeDefined();
    if (!event) throw new Error("expected the first settlement claim");
    event.status = "failed";

    const retry = await service.ingest(body, signature);
    const replay = await service.ingest(body, signature);
    expect(retry).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
    expect(event.status).toBe("completed");
  });

  it("fingerprints semantically equivalent JSON independent of property order", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const service = new EventIngestionService(store);
    const firstBody = Buffer.from(JSON.stringify({
      eventId: payload.eventId,
      eventType: payload.eventType,
      streamId: payload.streamId,
      occurredAt: payload.occurredAt,
    }));
    const replayBody = Buffer.from(JSON.stringify({
      occurredAt: payload.occurredAt,
      streamId: payload.streamId,
      eventType: payload.eventType,
      eventId: payload.eventId,
    }));

    const first = await service.ingest(firstBody, sign(firstBody.toString("utf8")));
    const replay = await service.ingest(replayBody, sign(replayBody.toString("utf8")));
    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
  });

  it("accepts the first metering sequence and advances its checkpoint", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const body = Buffer.from(JSON.stringify(meteringPayload));

    const result = await service.ingest(body, sign(body.toString("utf8")));

    expect(result).toMatchObject({ accepted: true, duplicate: false });
    expect(result).toMatchObject({ event: { sequence: 1, streamId: "stream_metered" } });
  });

  it("treats a repeated metering event id as harmless", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const body = Buffer.from(JSON.stringify(meteringPayload));
    const signature = sign(body.toString("utf8"));

    const first = await service.ingest(body, signature);
    const replay = await service.ingest(body, signature);

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
  });

  it("rejects a metering gap and accepts it after the missing sequence arrives", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const first = Buffer.from(JSON.stringify(meteringPayload));
    const thirdPayload = { ...meteringPayload, eventId: "evt_metering_3", sequence: 3 };
    const third = Buffer.from(JSON.stringify(thirdPayload));
    const secondPayload = { ...meteringPayload, eventId: "evt_metering_2", sequence: 2 };
    const second = Buffer.from(JSON.stringify(secondPayload));

    expect(await service.ingest(first, sign(first.toString("utf8")))).toMatchObject({ accepted: true });
    expect(await service.ingest(third, sign(third.toString("utf8")))).toMatchObject({
      accepted: false,
      code: "metering_gap",
    });
    expect(await service.ingest(second, sign(second.toString("utf8")))).toMatchObject({ accepted: true });
    expect(await service.ingest(third, sign(third.toString("utf8")))).toMatchObject({ accepted: true });
  });

  it("rejects late metering events and preserves stream isolation", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const firstPayload = { ...meteringPayload, eventId: "evt_a_1", streamId: "stream-a", sequence: 1 };
    const secondPayload = { ...meteringPayload, eventId: "evt_a_2", streamId: "stream-a", sequence: 2 };
    const latePayload = { ...meteringPayload, eventId: "evt_a_late", streamId: "stream-a", sequence: 1 };
    const otherPayload = { ...meteringPayload, eventId: "evt_b_1", streamId: "stream-b", sequence: 1 };

    const send = async (value: typeof meteringPayload) => {
      const body = Buffer.from(JSON.stringify(value));
      return service.ingest(body, sign(body.toString("utf8")));
    };

    await send(firstPayload);
    await send(secondPayload);
    expect(await send(latePayload)).toMatchObject({ accepted: false, code: "late_metering_event" });
    expect(await send(otherPayload)).toMatchObject({ accepted: true });
  });

  it("requires positive integer sequence metadata for metering events", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    for (const sequence of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      const value = { ...meteringPayload, eventId: `evt_invalid_${String(sequence)}`, sequence };
      const body = Buffer.from(JSON.stringify(value));
      expect(await service.ingest(body, sign(body.toString("utf8")))).toMatchObject({
        accepted: false,
        code: "invalid_payload",
      });
    }
  });
});
