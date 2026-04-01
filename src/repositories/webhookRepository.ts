/**
 * Data-access layer for webhook_subscriptions and webhook_deliveries.
 */

import { eq, and, lte, lt } from "drizzle-orm";
import { db } from "../db/index";
import {
  webhookSubscriptions,
  webhookDeliveries,
  WebhookSubscription,
  NewWebhookSubscription,
  WebhookDelivery,
  NewWebhookDelivery,
} from "../db/schema";

export class WebhookRepository {
  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  async createSubscription(data: NewWebhookSubscription): Promise<WebhookSubscription> {
    const [row] = await db.insert(webhookSubscriptions).values(data).returning();
    return row;
  }

  async findSubscriptionById(id: string): Promise<WebhookSubscription | null> {
    const [row] = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);
    return row ?? null;
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    return db.select().from(webhookSubscriptions);
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const result = await db
      .delete(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .returning({ id: webhookSubscriptions.id });
    return result.length > 0;
  }

  /** Return all enabled subscriptions that match a given event type. */
  async findEnabledSubscriptionsForEvent(eventType: string): Promise<WebhookSubscription[]> {
    const all = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.enabled, true));

    return all.filter((sub) => {
      if (!sub.eventTypes) return true; // empty = all events
      return sub.eventTypes.split(",").map((e) => e.trim()).includes(eventType);
    });
  }

  // -------------------------------------------------------------------------
  // Deliveries
  // -------------------------------------------------------------------------

  async createDelivery(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    const [row] = await db.insert(webhookDeliveries).values(data).returning();
    return row;
  }

  async findDeliveryById(id: string): Promise<WebhookDelivery | null> {
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Fetch pending deliveries whose next attempt time has arrived. */
  async findDueDeliveries(limit = 50): Promise<WebhookDelivery[]> {
    return db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.nextAttemptAt, new Date()),
        ),
      )
      .limit(limit);
  }

  async updateDelivery(
    id: string,
    patch: Partial<Pick<WebhookDelivery, "status" | "attempts" | "nextAttemptAt" | "lastHttpStatus" | "lastError">>,
  ): Promise<WebhookDelivery | null> {
    const [row] = await db
      .update(webhookDeliveries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, id))
      .returning();
    return row ?? null;
  }

  /** Delete deliveries older than `olderThanDays` days (housekeeping). */
  async pruneDeliveries(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const deleted = await db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.createdAt, cutoff))
      .returning({ id: webhookDeliveries.id });
    return deleted.length;
  }
}

export const webhookRepository = new WebhookRepository();
