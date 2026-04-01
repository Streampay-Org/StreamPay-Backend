/**
 * Integration tests for the outbound webhook subscription REST endpoints.
 * The webhookRepository is mocked to avoid a real DB connection.
 */

import request from "supertest";
import app from "../../index";
import { webhookRepository } from "../../repositories/webhookRepository";
import { WebhookSubscription } from "../../db/schema";

jest.mock("../../repositories/webhookRepository", () => ({
  webhookRepository: {
    createSubscription: jest.fn(),
    listSubscriptions: jest.fn(),
    deleteSubscription: jest.fn(),
    findSubscriptionById: jest.fn(),
    findEnabledSubscriptionsForEvent: jest.fn(),
    createDelivery: jest.fn(),
    findDeliveryById: jest.fn(),
    findDueDeliveries: jest.fn(),
    updateDelivery: jest.fn(),
    pruneDeliveries: jest.fn(),
  },
}));

const repo = webhookRepository as jest.Mocked<typeof webhookRepository>;

const makeSub = (overrides: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  url: "https://example.com/hook",
  secret: "stored-secret",
  eventTypes: "stream_created,settled",
  enabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// POST /api/v1/webhooks
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks", () => {
  it("creates a subscription and returns 201 with a secret", async () => {
    repo.createSubscription.mockResolvedValue(makeSub());

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", eventTypes: ["stream_created", "settled"] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      url: "https://example.com/hook",
      eventTypes: expect.arrayContaining(["stream_created", "settled"]),
      enabled: true,
    });
    // Secret must be present at creation time
    expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates a subscription with no eventTypes (all events)", async () => {
    repo.createSubscription.mockResolvedValue(makeSub({ eventTypes: "" }));

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook" });

    expect(res.status).toBe(201);
    expect(res.body.eventTypes).toEqual([]);
  });

  it("returns 400 for an invalid URL", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks
// ---------------------------------------------------------------------------

describe("GET /api/v1/webhooks", () => {
  it("returns a list of subscriptions without secrets", async () => {
    repo.listSubscriptions.mockResolvedValue([makeSub()]);

    const res = await request(app).get("/api/v1/webhooks");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty("secret");
    expect(res.body[0]).toMatchObject({ id: expect.any(String), url: "https://example.com/hook" });
  });

  it("returns an empty array when no subscriptions exist", async () => {
    repo.listSubscriptions.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/webhooks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/webhooks/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/webhooks/:id", () => {
  const validId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("returns 204 when the subscription is deleted", async () => {
    repo.deleteSubscription.mockResolvedValue(true);

    const res = await request(app).delete(`/api/v1/webhooks/${validId}`);

    expect(res.status).toBe(204);
    expect(repo.deleteSubscription).toHaveBeenCalledWith(validId);
  });

  it("returns 404 when the subscription does not exist", async () => {
    repo.deleteSubscription.mockResolvedValue(false);

    const res = await request(app).delete(`/api/v1/webhooks/${validId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Subscription not found");
  });

  it("returns 400 for an invalid UUID", async () => {
    const res = await request(app).delete("/api/v1/webhooks/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid subscription ID format");
  });
});
