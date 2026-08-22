/**
 * SSE route — real-time stream update channel.
 *
 * Endpoint: GET /api/v1/streams/events
 *   Subscribes the client to updates for ALL streams.
 *
 * Endpoint: GET /api/v1/streams/:id/events
 *   Subscribes the client to updates for a single stream.
 *
 * Both endpoints require the `x-api-key` header (apiKeyAuthMiddleware).
 *
 * Event format (Server-Sent Events):
 *   event: stream-update
 *   id: <streamId>:<occurredAt>
 *   data: { "eventType": "...", "streamId": "...", "occurredAt": "...", "data": {...} }
 *
 * Backpressure: see SseHub. When a client's outbound queue overflows, the
 * oldest buffered event is dropped and a `stream-update:dropped` event is
 * emitted so the client can re-fetch canonical state.
 */

import { Router, Request, Response } from "express";
import { sseHub } from "../../services/sseHub";
import { uuidSchema } from "../../validation/schemas";

const router = Router();

function setupSse(req: Request, res: Response, streamId: string | null): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
  res.flushHeaders();

  const clientId = sseHub.subscribe(res, streamId);

  // Send an initial comment so the client knows the connection is live.
  res.write(": connected\n\n");

  req.on("close", () => {
    sseHub.disconnect(clientId);
  });
}

// GET /api/v1/streams/events — all streams
router.get("/events", (req: Request, res: Response) => {
  setupSse(req, res, null);
});

// GET /api/v1/streams/:id/events — single stream
router.get("/:id/events", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!uuidSchema.safeParse(id).success) {
    res.status(400).json({ error: "Invalid stream ID format" });
    return;
  }
  setupSse(req, res, id);
});

export default router;
