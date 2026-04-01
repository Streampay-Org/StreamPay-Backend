/**
 * REST endpoints for managing outbound webhook subscriptions.
 *
 * POST   /api/v1/webhooks          — register a new subscription
 * GET    /api/v1/webhooks          — list all subscriptions (secret redacted)
 * DELETE /api/v1/webhooks/:id      — remove a subscription
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { webhookRepository } from "../../repositories/webhookRepository";

const router = Router();

const createSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  /** Optional list of event types to subscribe to; omit for all events. */
  eventTypes: z.array(z.string().min(1)).optional(),
});

// POST /api/v1/webhooks
router.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", issues: parsed.error.flatten().fieldErrors });
  }

  const { url, eventTypes } = parsed.data;

  // Generate a random signing secret — returned once, never again.
  const secret = crypto.randomBytes(32).toString("hex");

  const sub = await webhookRepository.createSubscription({
    url,
    secret,
    eventTypes: eventTypes ? eventTypes.join(",") : "",
    enabled: true,
  });

  return res.status(201).json({
    id: sub.id,
    url: sub.url,
    eventTypes: sub.eventTypes ? sub.eventTypes.split(",").filter(Boolean) : [],
    enabled: sub.enabled,
    createdAt: sub.createdAt,
    // Secret returned only at creation time.
    secret,
  });
});

// GET /api/v1/webhooks
router.get("/", async (_req: Request, res: Response) => {
  const subs = await webhookRepository.listSubscriptions();
  return res.json(
    subs.map((s) => ({
      id: s.id,
      url: s.url,
      eventTypes: s.eventTypes ? s.eventTypes.split(",").filter(Boolean) : [],
      enabled: s.enabled,
      createdAt: s.createdAt,
    })),
  );
});

// DELETE /api/v1/webhooks/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: "Invalid subscription ID format" });
  }

  const deleted = await webhookRepository.deleteSubscription(id);
  if (!deleted) {
    return res.status(404).json({ error: "Subscription not found" });
  }

  return res.status(204).send();
});

export default router;
