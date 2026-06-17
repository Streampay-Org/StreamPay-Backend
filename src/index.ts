/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import express, { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import streamRoutes from "./api/v1/streams";
import { generateOpenApi } from "./api/v1/openapi";
import { env } from "./config/env";
import { apiKeyAuthMiddleware } from "./middleware/apiKeyAuth";
import { webhookRepository } from "./repositories/webhookRepository";
import indexerWebhookRouter from "./routes/webhooks/indexer";
import { WebhookDeliveryService } from "./services/webhookDeliveryService";

export const JSON_BODY_LIMIT = "100kb";
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

const payloadTooLargeResponse = {
  error: "payload_too_large",
  message: `JSON request body exceeds ${JSON_BODY_LIMIT} limit.`,
};

export const rejectOversizedJsonPayload = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) {
    next();
    return;
  }

  const contentLengthHeader = req.header("content-length");
  if (!contentLengthHeader) {
    next();
    return;
  }

  const declaredContentLength = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(declaredContentLength) || declaredContentLength <= JSON_BODY_LIMIT_BYTES) {
    next();
    return;
  }

  res.status(413).json(payloadTooLargeResponse);
};

export const httpBodyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const bodyParserError = error as { status?: number; type?: string };

  if (bodyParserError.status === 413 || bodyParserError.type === "entity.too.large") {
    res.status(413).json(payloadTooLargeResponse);
    return;
  }

  if (bodyParserError.status === 400 && bodyParserError.type === "entity.parse.failed") {
    res.status(400).json({
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    });
    return;
  }

  next(error);
};

const app = express();
const PORT = env.PORT;

app.use(cors());

app.use("/webhooks/indexer", indexerWebhookRouter);

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "streampay-backend",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/openapi.json", (_req: Request, res: Response) => {
  res.json(generateOpenApi());
});

app.use(
  "/api/v1",
  apiKeyAuthMiddleware,
  rejectOversizedJsonPayload,
  express.json({ limit: JSON_BODY_LIMIT }),
);

app.use("/api/v1/streams", streamRoutes);

app.use(httpBodyErrorHandler);

/* istanbul ignore next */
if (require.main === module) {
  const deliveryService = new WebhookDeliveryService(webhookRepository);
  deliveryService.startWorker();

  app.listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
