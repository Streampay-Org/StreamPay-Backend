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
