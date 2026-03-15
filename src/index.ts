/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import express, { Request, Response } from "express";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "streampay-backend", timestamp: new Date().toISOString() });
});

app.get("/api/streams", (_req: Request, res: Response) => {
  res.json({ streams: [], total: 0 });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
