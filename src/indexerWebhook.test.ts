import crypto from "crypto";
import request from "supertest";
import app from "./index";

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
    eventIngestionService.reset();
  });

  afterAll(() => {
    delete process.env.INDEXER_WEBHOOK_SECRET;
    eventIngestionService.reset();
  });

  it("accepts a valid signed event", async () => {
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
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

  it("rejects an invalid signature", async () => {
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
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
      .set("x-indexer-signature", signature)
      .send(body);

    const secondResponse = await request(app)
      .post("/webhooks/indexer")
      .set("Content-Type", "application/json")
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
      .set("x-indexer-signature", sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_body",
    });
  });
});
