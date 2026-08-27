import express, { Request, Response, Router } from "express";

import { apiKeyAuthMiddleware } from "../../middleware/apiKeyAuth";
import { requireRedisForMutation } from "../../middleware/redisAvailability";
import { eventIngestionService } from "../../services/eventIngestionService";
import { indexerEventsTotal } from "../../metrics/prometheus";
import { logStructured } from "../../telemetry/correlation";

export const INDEXER_WEBHOOK_BODY_LIMIT = "100kb";

const router = Router();
const rawJsonBodyParser = express.raw({ type: "application/json", limit: INDEXER_WEBHOOK_BODY_LIMIT });

router.post(
  "/",
  apiKeyAuthMiddleware,
  requireRedisForMutation,
  rawJsonBodyParser,
  async (req: Request<Record<string, never>, unknown, Buffer>, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        error: "invalid_body",
        message: "Indexer webhook requires the raw request body for signature verification.",
      });
    }

    const signatureHeader = req.header("x-indexer-signature") ?? undefined;
    const result = await eventIngestionService.ingest(req.body, signatureHeader, req.correlationId);

    if (!result.accepted) {
      const statusByCode = {
        missing_secret: 500,
        invalid_signature: 401,
        invalid_json: 400,
        invalid_payload: 400,
        idempotency_unavailable: 503,
        idempotency_conflict: 409,
        settlement_in_progress: 409,
        metering_gap: 409,
        late_metering_event: 409,
      } as const;

      indexerEventsTotal.labels("unknown", result.code).inc();
      logStructured("warn", "indexer_event_rejected", {
        correlationId: req.correlationId,
        outcome: result.code,
      });
      return res.status(statusByCode[result.code]).json({
        error: result.code,
        message: result.message,
      });
    }

    indexerEventsTotal.labels(result.event.eventType, result.duplicate ? "duplicate" : "accepted").inc();
    logStructured("info", "indexer_event_ingested", {
      correlationId: req.correlationId,
      eventId: result.event.eventId,
      eventType: result.event.eventType,
      streamId: result.event.streamId,
      outcome: result.duplicate ? "duplicate" : "accepted",
    });
    return res.status(result.duplicate ? 202 : 200).json({
      accepted: true,
      duplicate: result.duplicate,
      eventId: result.event.eventId,
      eventType: result.event.eventType,
    });
  },
);

export default router;
