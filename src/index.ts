/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import express, { Request, Response } from "express";
import streamRoutes from "./api/v1/streams";

import indexerWebhookRouter from "./routes/webhooks/indexer";

import { env } from "./config/env";

const app = express();
const PORT = env.PORT;

app.use(cors());
app.use("/webhooks/indexer", express.raw({ type: "application/json" }), indexerWebhookRouter);
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "streampay-backend", timestamp: new Date().toISOString() });
});

app.use("/api/v1/streams", streamRoutes);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
