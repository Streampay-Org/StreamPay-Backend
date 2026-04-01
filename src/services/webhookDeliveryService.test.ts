/**
 * Tests for WebhookDeliveryService — signing, backoff, enqueue, and delivery logic.
 * The DB repository is fully mocked so no real database is needed.
 */

import crypto from "crypto";
import {
  WebhookDeliveryService,
  signPayload,
  nextRetryDelay,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} from "./webhookDeliveryService";
import { WebhookRepository } from "../repositories/webhookRepository";
import { WebhookDelivery, WebhookSubscription } from "../db/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSub = (overrides: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id: "sub-1",
  url: "https://example.com/hook",
  secret: "test-secret",
  eventTypes: "stream_created",
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDelivery = (overrides: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
  id: "del-1",
  subscriptionId: "sub-1",
  eventType: "stream_created",
  payload: JSON.stringify({ eventType: "stream_created", streamId: "s1", occurredAt: "2026-01-01T00:00:00Z" }),
  status: "pending",
  attempts: 0,
  nextAttemptAt: new Date(Date.now() - 1000),
  lastHttpStatus: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockRepo = (): jest.Mocked<WebhookRepository> =>
  ({
    createSubscription: jest.fn(),
    findSubscriptionById: jest.fn(),
    listSubscriptions: jest.fn(),
    deleteSubscription: jest.fn(),
    findEnabledSubscriptionsForEvent: jest.fn(),
    createDelivery: jest.fn(),
    findDeliveryById: jest.fn(),
    findDueDeliveries: jest.fn(),
    updateDelivery: jest.fn(),
    pruneDeliveries: jest.fn(),
  }) as unknown as jest.Mocked<WebhookRepository>;

// ---------------------------------------------------------------------------
// signPayload
// ---------------------------------------------------------------------------

describe("signPayload", () => {
  it("produces a sha256= prefixed HMAC", () => {
    const sig = signPayload("hello", "secret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    expect(signPayload("payload", "key")).toBe(signPayload("payload", "key"));
  });

  it("differs when the secret changes", () => {
    expect(signPayload("payload", "key1")).not.toBe(signPayload("payload", "key2"));
  });

  it("matches a manually computed HMAC", () => {
    const expected =
      "sha256=" + crypto.createHmac("sha256", "s").update("p").digest("hex");
    expect(signPayload("p", "s")).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// nextRetryDelay
// ---------------------------------------------------------------------------

describe("nextRetryDelay", () => {
  it("returns BASE_DELAY_MS on first retry (attempt=1)", () => {
    expect(nextRetryDelay(1)).toBe(BASE_DELAY_MS);
  });

  it("doubles on each subsequent attempt", () => {
    expect(nextRetryDelay(2)).toBe(BASE_DELAY_MS * 2);
    expect(nextRetryDelay(3)).toBe(BASE_DELAY_MS * 4);
  });

  it("is capped at MAX_DELAY_MS", () => {
    expect(nextRetryDelay(100)).toBe(MAX_DELAY_MS);
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.enqueue
// ---------------------------------------------------------------------------

describe("WebhookDeliveryService.enqueue", () => {
  it("creates a delivery for each matching subscription", async () => {
    const repo = mockRepo();
    const sub = makeSub();
    const delivery = makeDelivery();
    repo.findEnabledSubscriptionsForEvent.mockResolvedValue([sub]);
    repo.createDelivery.mockResolvedValue(delivery);

    const svc = new WebhookDeliveryService(repo);
    const result = await svc.enqueue({ eventType: "stream_created", streamId: "s1", occurredAt: "2026-01-01T00:00:00Z" });

    expect(repo.findEnabledSubscriptionsForEvent).toHaveBeenCalledWith("stream_created");
    expect(repo.createDelivery).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no subscriptions match", async () => {
    const repo = mockRepo();
    repo.findEnabledSubscriptionsForEvent.mockResolvedValue([]);

    const svc = new WebhookDeliveryService(repo);
    const result = await svc.enqueue({ eventType: "settled", streamId: "s1", occurredAt: "2026-01-01T00:00:00Z" });

    expect(result).toHaveLength(0);
    expect(repo.createDelivery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.attempt — success path
// ---------------------------------------------------------------------------

describe("WebhookDeliveryService.attempt — success", () => {
  it("marks delivery as success on HTTP 200", async () => {
    const repo = mockRepo();
    const sub = makeSub();
    const delivery = makeDelivery();
    repo.findSubscriptionById.mockResolvedValue(sub);
    repo.updateDelivery.mockResolvedValue({ ...delivery, status: "success" });

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(delivery);

    expect(mockFetch).toHaveBeenCalledWith(
      sub.url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-StreamPay-Signature": expect.stringMatching(/^sha256=/) }),
      }),
    );
    expect(repo.updateDelivery).toHaveBeenCalledWith(delivery.id, expect.objectContaining({ status: "success" }));
  });

  it("sends the correct event type header", async () => {
    const repo = mockRepo();
    repo.findSubscriptionById.mockResolvedValue(makeSub());
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(makeDelivery({ eventType: "settled" }));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-StreamPay-Event": "settled" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.attempt — retry / failure paths
// ---------------------------------------------------------------------------

describe("WebhookDeliveryService.attempt — retries", () => {
  it("schedules a retry with backoff on non-2xx response", async () => {
    const repo = mockRepo();
    repo.findSubscriptionById.mockResolvedValue(makeSub());
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(makeDelivery({ attempts: 0 }));

    expect(repo.updateDelivery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "pending", attempts: 1, lastHttpStatus: 503 }),
    );
  });

  it("marks as failed after MAX_ATTEMPTS", async () => {
    const repo = mockRepo();
    repo.findSubscriptionById.mockResolvedValue(makeSub());
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(makeDelivery({ attempts: MAX_ATTEMPTS - 1 }));

    expect(repo.updateDelivery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("marks as failed when fetch throws (network error)", async () => {
    const repo = mockRepo();
    repo.findSubscriptionById.mockResolvedValue(makeSub());
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(makeDelivery({ attempts: MAX_ATTEMPTS - 1 }));

    expect(repo.updateDelivery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", lastError: "ECONNREFUSED" }),
    );
  });

  it("marks as failed when subscription is deleted", async () => {
    const repo = mockRepo();
    repo.findSubscriptionById.mockResolvedValue(null);
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn();
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.attempt(makeDelivery());

    expect(mockFetch).not.toHaveBeenCalled();
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", lastError: "Subscription not found" }),
    );
  });
});

// ---------------------------------------------------------------------------
// WebhookDeliveryService.processDue
// ---------------------------------------------------------------------------

describe("WebhookDeliveryService.processDue", () => {
  it("calls attempt for each due delivery", async () => {
    const repo = mockRepo();
    const deliveries = [makeDelivery({ id: "d1" }), makeDelivery({ id: "d2" })];
    repo.findDueDeliveries.mockResolvedValue(deliveries);
    repo.findSubscriptionById.mockResolvedValue(makeSub());
    repo.updateDelivery.mockResolvedValue(makeDelivery());

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.processDue();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no deliveries are due", async () => {
    const repo = mockRepo();
    repo.findDueDeliveries.mockResolvedValue([]);

    const mockFetch = jest.fn();
    const svc = new WebhookDeliveryService(repo, mockFetch as unknown as typeof fetch);

    await svc.processDue();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
