import express, { Request, Response, Router } from "express";

import { apiKeyAuthMiddleware } from "../../middleware/apiKeyAuth";
import { eventIngestionService } from "../../services/eventIngestionService";

export const INDEXER_WEBHOOK_BODY_LIMIT = "100kb";

const router = Router();
const rawJsonBodyParser = express.raw({ type: "application/json", limit: INDEXER_WEBHOOK_BODY_LIMIT });

router.post(
  "/",
  apiKeyAuthMiddleware,
  rawJsonBodyParser,
  (req: Request<Record<string, never>, unknown, Buffer>, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        error: "invalid_body",
        message: "Indexer webhook requires the raw request body for signature verification.",
      });
    }

    const signatureHeader = req.header("x-indexer-signature") ?? undefined;
    const result = eventIngestionService.ingest(req.body, signatureHeader);

    if (!result.accepted) {
      const statusByCode = {
        missing_secret: 500,
        invalid_signature: 401,
        invalid_json: 400,
        invalid_payload: 400,
      } as const;

      return res.status(statusByCode[result.code]).json({
        error: result.code,
        message: result.message,
      });
    }

    return res.status(result.duplicate ? 202 : 200).json({
      accepted: true,
      duplicate: result.duplicate,
      eventId: result.event.eventId,
      eventType: result.event.eventType,
    });
  },
);

export default router;
