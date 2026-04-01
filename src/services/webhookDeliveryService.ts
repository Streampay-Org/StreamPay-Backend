/**
 * Outbound webhook delivery service.
 *
 * Responsibilities:
 *  - Sign payloads with HMAC-SHA256 using the subscription's secret.
 *  - Dispatch HTTP POST to the subscriber URL.
 *  - Retry failed deliveries with exponential backoff (up to MAX_ATTEMPTS).
 *  - Enqueue deliveries for all matching subscriptions when an event fires.
 */

import crypto from "crypto";
import { WebhookRepository } from "../repositories/webhookRepository";
import { WebhookDelivery } from "../db/schema";

export const MAX_ATTEMPTS = 5;
/** Base delay in ms; actual delay = BASE_DELAY_MS * 2^(attempt-1), capped at MAX_DELAY_MS. */
export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 300_000; // 5 minutes

export type OutboundEvent = {
  eventType: string;
  streamId: string;
  occurredAt: string;
  data?: Record<string, unknown>;
};

/** Compute HMAC-SHA256 signature over the raw payload string. */
export function signPayload(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Compute the next retry delay using exponential backoff. */
export function nextRetryDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

export class WebhookDeliveryService {
  constructor(
    private readonly repo: WebhookRepository,
    /** Injected fetch — defaults to global fetch (Node 18+). */
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /**
   * Enqueue delivery records for every enabled subscription that matches
   * the given event type. Call this whenever a stream lifecycle event occurs.
   */
  async enqueue(event: OutboundEvent): Promise<WebhookDelivery[]> {
    const subs = await this.repo.findEnabledSubscriptionsForEvent(event.eventType);
    const deliveries: WebhookDelivery[] = [];

    for (const sub of subs) {
      const delivery = await this.repo.createDelivery({
        subscriptionId: sub.id,
        eventType: event.eventType,
        payload: JSON.stringify(event),
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      });
      deliveries.push(delivery);
    }

    return deliveries;
  }

  /**
   * Process all due pending deliveries.
   * Intended to be called by a periodic worker (e.g. setInterval or a cron job).
   */
  async processDue(): Promise<void> {
    const due = await this.repo.findDueDeliveries();
    await Promise.all(due.map((d) => this.attempt(d)));
  }

  /**
   * Attempt a single delivery. Updates the delivery record with the result.
   */
  async attempt(delivery: WebhookDelivery): Promise<void> {
    const sub = await this.repo.findSubscriptionById(delivery.subscriptionId);
    if (!sub) {
      // Subscription was deleted — mark as failed and stop.
      await this.repo.updateDelivery(delivery.id, { status: "failed", lastError: "Subscription not found" });
      return;
    }

    const attempts = delivery.attempts + 1;
    const signature = signPayload(delivery.payload, sub.secret);

    let httpStatus: number | undefined;
    let errorMessage: string | undefined;

    try {
      const response = await this.fetcher(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-StreamPay-Signature": signature,
          "X-StreamPay-Event": delivery.eventType,
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(10_000),
      });

      httpStatus = response.status;

      if (response.ok) {
        await this.repo.updateDelivery(delivery.id, {
          status: "success",
          attempts,
          lastHttpStatus: httpStatus,
        });
        return;
      }

      errorMessage = `HTTP ${httpStatus}`;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Delivery failed — schedule retry or mark permanently failed.
    if (attempts >= MAX_ATTEMPTS) {
      await this.repo.updateDelivery(delivery.id, {
        status: "failed",
        attempts,
        lastHttpStatus: httpStatus,
        lastError: errorMessage,
      });
    } else {
      const delayMs = nextRetryDelay(attempts);
      const nextAttemptAt = new Date(Date.now() + delayMs);
      await this.repo.updateDelivery(delivery.id, {
        status: "pending",
        attempts,
        lastHttpStatus: httpStatus,
        lastError: errorMessage,
        nextAttemptAt,
      });
    }
  }

  /** Start a background polling loop. Returns a handle to stop it. */
  startWorker(intervalMs = 10_000): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.processDue().catch((err) =>
        console.error("[webhook-worker] processDue error:", err),
      );
    }, intervalMs);
  }
}

/** Build a service instance backed by the real DB repository. */
export const createWebhookDeliveryService = (repo: WebhookRepository) =>
  new WebhookDeliveryService(repo);
