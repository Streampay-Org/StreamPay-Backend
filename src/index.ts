/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import express from "express";
import v1Router from "./api/v1/router";

import indexerWebhookRouter from "./routes/webhooks/indexer";
import healthRouter from "./routes/health";
import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

import { env } from "./config/env";

const app = express();
const PORT = env.PORT;

app.get("/metrics", metricsHandler);
app.use(metricsMiddleware);

app.use(cors());
app.use("/webhooks/indexer", express.raw({ type: "application/json" }), indexerWebhookRouter);
app.use(express.json());

app.use("/health", healthRouter);

app.use("/api/v1", v1Router);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
