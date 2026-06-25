import crypto from "crypto";
import request from "supertest";
import app from "./index";

import { apiKeyStore, refreshApiKeyStore } from "./middleware/apiKeyAuth";
import { eventIngestionService } from "./services/eventIngestionService";

const secret = "test-indexer-secret";

const payload = {
  eventId: "evt_123",
  eventType: "stream_created",
  streamId: "stream_456",
  occurredAt: "2026-03-23T10:00:00.000Z",
  chainId: "stellar-testnet",
  transactionHash: "abc123",
  data: {
    amount: "42",
  },
};

function sign(body: string): string {
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

describe("POST /webhooks/indexer", () => {
  beforeEach(() => {
    process.env.INDEXER_WEBHOOK_SECRET = secret;
    process.env.API_KEYS = "test-1234";
    refreshApiKeyStore();
    eventIngestionService.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    eventIngestionService.reset();
    apiKeyStore.clear();
    delete process.env.INDEXER_WEBHOOK_SECRET;
    delete process.env.API_KEYS;
  });

  it("accepts a valid signed event", async () => {
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: true,
      duplicate: false,
      eventId: payload.eventId,
      eventType: payload.eventType,
    });
  });

  it("accepts a valid API key from Authorization ApiKey header", async () => {
    const body = JSON.stringify({ ...payload, eventId: "evt_authorization_header" });

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("Authorization", "ApiKey test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accepted: true,
      duplicate: false,
      eventId: "evt_authorization_header",
    });
  });

  it("rejects a missing API key before raw-body parsing and HMAC verification", async () => {
    const body = JSON.stringify(payload);
    const ingestSpy = jest.spyOn(eventIngestionService, "ingest");

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key before HMAC verification", async () => {
    const body = JSON.stringify(payload);
    const ingestSpy = jest.spyOn(eventIngestionService, "ingest");

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "wrong-key")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key invalid or revoked" });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("rejects a revoked API key before HMAC verification", async () => {
    const record = apiKeyStore.findKeyByValue("test-1234");
    expect(record).not.toBeNull();
    if (record) {
      apiKeyStore.revokeKey(record.id);
    }

    const body = JSON.stringify(payload);
    const ingestSpy = jest.spyOn(eventIngestionService, "ingest");

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key invalid or revoked" });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature after accepting API key auth", async () => {
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", "sha256=deadbeef")
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "invalid_signature",
    });
  });

  it("ignores a duplicate event id", async () => {
    const body = JSON.stringify(payload);
    const signature = sign(body);

    const firstResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    const secondResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(202);
    expect(secondResponse.body).toEqual({
      accepted: true,
      duplicate: true,
      eventId: payload.eventId,
      eventType: payload.eventType,
    });
  });

  it("returns 500 when the webhook secret is missing", async () => {
    delete process.env.INDEXER_WEBHOOK_SECRET;
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "missing_secret",
    });
  });

  it("rejects malformed JSON even with a valid signature", async () => {
    const body = '{"eventId":';

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_json",
    });
  });

  it("rejects payloads with missing required fields", async () => {
    const body = JSON.stringify({
      eventId: "evt_124",
      eventType: "settled",
    });

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_payload",
    });
  });

  it("requires a raw JSON body for verification", async () => {
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "text/plain")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_body",
    });
  });

  it("does not apply POST webhook API key auth to unsupported webhook methods", async () => {
    const res = await request(app).get("/webhooks/indexer");

    expect(res.status).toBe(404);
  });
});

describe("POST /webhooks/indexer - settlement idempotency", () => {
  const settledPayload = {
    eventId: "evt_settled_123",
    eventType: "settled",
    streamId: "stream_456",
    occurredAt: "2026-03-23T10:00:00.000Z",
    chainId: "stellar-testnet",
    transactionHash: "tx_settled_abc123",
    data: {
      amount: "100",
      settledAt: "2026-03-23T10:00:00.000Z",
    },
  };

  beforeEach(() => {
    process.env.INDEXER_WEBHOOK_SECRET = secret;
    process.env.API_KEYS = "test-1234";
    refreshApiKeyStore();
    eventIngestionService.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    eventIngestionService.reset();
    apiKeyStore.clear();
    delete process.env.INDEXER_WEBHOOK_SECRET;
    delete process.env.API_KEYS;
  });

  it("accepts a first-time settled event with 200 and duplicate: false", async () => {
    const body = JSON.stringify(settledPayload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: true,
      duplicate: false,
      eventId: settledPayload.eventId,
      eventType: settledPayload.eventType,
    });
  });

  it("returns 202 with duplicate: true for redelivered settled event", async () => {
    const body = JSON.stringify(settledPayload);
    const signature = sign(body);

    const firstResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    const secondResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.duplicate).toBe(false);

    expect(secondResponse.status).toBe(202);
    expect(secondResponse.body).toEqual({
      accepted: true,
      duplicate: true,
      eventId: settledPayload.eventId,
      eventType: settledPayload.eventType,
    });
  });

  it("ensures settled event processing is idempotent across multiple deliveries", async () => {
    const body = JSON.stringify(settledPayload);
    const signature = sign(body);

    // Mock a settlement processing function to track calls
    const settlementProcessor = jest.fn();

    const responses = await Promise.all([
      request(app)
        .post("/webhooks/indexer")
        .set("Content-Type", "application/json")
        .set("x-api-key", "test-1234")
        .set("x-indexer-signature", signature)
        .send(body),
      request(app)
        .post("/webhooks/indexer")
        .set("Content-Type", "application/json")
        .set("x-api-key", "test-1234")
        .set("x-indexer-signature", signature)
        .send(body),
      request(app)
        .post("/webhooks/indexer")
        .set("Content-Type", "application/json")
        .set("x-api-key", "test-1234")
        .set("x-indexer-signature", signature)
        .send(body),
    ]);

    // Only the first request should be processed (200), others should be duplicates (202)
    const successCount = responses.filter((r) => r.status === 200).length;
    const duplicateCount = responses.filter((r) => r.status === 202).length;

    expect(successCount).toBe(1);
    expect(duplicateCount).toBe(2);

    // In a real implementation, settlementProcessor would be called exactly once
    // For this test, we verify the ingestion service correctly identifies duplicates
    expect(responses[0].body.duplicate).toBe(false);
    expect(responses[1].body.duplicate).toBe(true);
    expect(responses[2].body.duplicate).toBe(true);
  });

  it("returns 500 for settled event when webhook secret is missing", async () => {
    delete process.env.INDEXER_WEBHOOK_SECRET;
    const body = JSON.stringify(settledPayload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "missing_secret",
    });
  });

  it("returns 401 for settled event with invalid signature", async () => {
    const body = JSON.stringify(settledPayload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", "sha256=invalidsignature")
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "invalid_signature",
    });
  });

  it("returns 400 for settled event with invalid JSON", async () => {
    const body = '{"eventId":';

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_json",
    });
  });

  it("returns 400 for settled event with missing required fields", async () => {
    const body = JSON.stringify({
      eventId: "evt_settled_124",
      eventType: "settled",
      // Missing streamId and occurredAt
    });

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_payload",
    });
  });

  it("handles settled event idempotency after service reset", async () => {
    const body = JSON.stringify(settledPayload);
    const signature = sign(body);

    // First delivery
    const firstResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.duplicate).toBe(false);

    // Reset the service (simulating service restart)
    eventIngestionService.reset();

    // Second delivery after reset should be treated as new
    const secondResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
      .set("x-api-key", "test-1234")
      .set("x-indexer-signature", signature)
      .send(body);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(false);
  });
});
