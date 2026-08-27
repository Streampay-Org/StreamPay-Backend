import crypto from "crypto";

import { EventIngestionService } from "../eventIngestionService";
import type { ProcessedIndexerEventStore } from "../../repositories/processedIndexerEventRepository";
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
  readonly eventIds = new Set<string>();
  readonly calls: string[] = [];
  failRecord = false;

  async record(eventId: string): Promise<boolean> {
    this.calls.push(eventId);
    if (this.failRecord) {
      throw new Error("database unavailable");
    }
    if (this.eventIds.has(eventId)) {
      return false;
    }
    this.eventIds.add(eventId);
    return true;
  }

  async reset(): Promise<void> {
    this.eventIds.clear();
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

  it("rejects a metering event that skips the next sequence", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const body = Buffer.from(JSON.stringify({ ...meteringPayload, eventId: "evt_gap", sequence: 3 }));

    const result = await service.ingest(body, sign(body.toString("utf8")));

    expect(result).toEqual({
      accepted: false,
      code: "metering_gap",
      message: "Metering sequence gap: expected 1, received 3.",
    });
  });

  it("accepts a gap event after the missing sequence is recovered", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const firstBody = Buffer.from(JSON.stringify(meteringPayload));
    const thirdPayload = { ...meteringPayload, eventId: "evt_metering_3", sequence: 3 };
    const thirdBody = Buffer.from(JSON.stringify(thirdPayload));
    const secondPayload = { ...meteringPayload, eventId: "evt_metering_2", sequence: 2 };
    const secondBody = Buffer.from(JSON.stringify(secondPayload));

    expect(await service.ingest(firstBody, sign(firstBody.toString("utf8")))).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(await service.ingest(thirdBody, sign(thirdBody.toString("utf8")))).toMatchObject({
      accepted: false,
      code: "metering_gap",
    });
    expect(await service.ingest(secondBody, sign(secondBody.toString("utf8")))).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(await service.ingest(thirdBody, sign(thirdBody.toString("utf8")))).toMatchObject({
      accepted: true,
      duplicate: false,
    });
  });

  it("rejects a late metering event without moving the checkpoint backward", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const first = Buffer.from(JSON.stringify(meteringPayload));
    const secondPayload = { ...meteringPayload, eventId: "evt_metering_2", sequence: 2 };
    const second = Buffer.from(JSON.stringify(secondPayload));
    const latePayload = { ...meteringPayload, eventId: "evt_metering_late", sequence: 1 };
    const late = Buffer.from(JSON.stringify(latePayload));

    await service.ingest(first, sign(first.toString("utf8")));
    await service.ingest(second, sign(second.toString("utf8")));
    const result = await service.ingest(late, sign(late.toString("utf8")));

    expect(result).toEqual({
      accepted: false,
      code: "late_metering_event",
      message: "Late metering event rejected at checkpoint 2.",
    });
  });

  it("requires a positive integer sequence for metering event types", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const candidates = [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"];

    for (const sequence of candidates) {
      const body = Buffer.from(JSON.stringify({
        ...meteringPayload,
        eventId: `evt_invalid_${String(sequence)}`,
        sequence,
      }));
      const result = await service.ingest(body, sign(body.toString("utf8")));
      expect(result).toMatchObject({ accepted: false, code: "invalid_payload" });
    }
  });

  it("keeps checkpoints isolated between streams", async () => {
    const store = new FakeProcessedIndexerEventStore();
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const service = new EventIngestionService(store, checkpoints);
    const firstPayload = { ...meteringPayload, eventId: "evt_stream_a_1", streamId: "stream-a", sequence: 1 };
    const otherPayload = { ...meteringPayload, eventId: "evt_stream_b_1", streamId: "stream-b", sequence: 1 };
    const firstBody = Buffer.from(JSON.stringify(firstPayload));
    const otherBody = Buffer.from(JSON.stringify(otherPayload));

    const first = await service.ingest(firstBody, sign(firstBody.toString("utf8")));
    const other = await service.ingest(otherBody, sign(otherBody.toString("utf8")));

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(other).toMatchObject({ accepted: true, duplicate: false });
  });

  it("preserves metering checkpoint state across service instances", async () => {
    const checkpoints = new InMemoryMeteringCheckpointStore();
    const firstStore = new FakeProcessedIndexerEventStore();
    const restartedStore = new FakeProcessedIndexerEventStore();
    const firstService = new EventIngestionService(firstStore, checkpoints);
    const restartedService = new EventIngestionService(restartedStore, checkpoints);
    const body = Buffer.from(JSON.stringify(meteringPayload));
    const signature = sign(body.toString("utf8"));

    const first = await firstService.ingest(body, signature);
    const replay = await restartedService.ingest(body, signature);

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
  });
});
