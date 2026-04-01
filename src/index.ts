/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import express, { Request, Response } from "express";
import streamRoutes from "./api/v1/streams";
import { generateOpenApi } from "./api/v1/openapi";
import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

import indexerWebhookRouter from "./routes/webhooks/indexer";
import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

import { env } from "./config/env";
import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

const app = express();
const PORT = env.PORT;

app.use(cors());
app.use(
  "/webhooks/indexer",
  express.raw({ type: "application/json" }),
  indexerWebhookRouter,
);
app.use(express.json());

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

app.use("/api/v1/streams", streamRoutes);

if (require.main === module) {
  const deliveryService = new WebhookDeliveryService(webhookRepository);
  deliveryService.startWorker();

  app.listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
