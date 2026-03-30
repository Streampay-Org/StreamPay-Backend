/**
 * StreamPay Backend — API gateway for stream management, metering, and settlement.
 */

import cors from "cors";
import http from "http";
import express, { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import v1Router from "./api/v1/router";
import { metricsHandler, metricsMiddleware } from "./metrics/prometheus";

import indexerWebhookRouter from "./routes/webhooks/indexer";

import { env } from "./config/env";

export const JSON_BODY_LIMIT = "100kb";
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;
export const MAX_HEADER_SIZE_BYTES = 16 * 1024;

const payloadTooLargeResponse = {
  error: "payload_too_large",
  message: `JSON request body exceeds ${JSON_BODY_LIMIT} limit.`,
};

const headersTooLargeResponse = {
  error: "headers_too_large",
  message: `Request headers exceed ${MAX_HEADER_SIZE_BYTES} byte limit.`,
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

app.get("/metrics", metricsHandler);
app.use(metricsMiddleware);

app.use(cors());
app.use(rejectOversizedJsonPayload);
app.use(
  "/webhooks/indexer",
  express.raw({ type: "application/json", limit: JSON_BODY_LIMIT }),
  indexerWebhookRouter,
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "streampay-backend", timestamp: new Date().toISOString() });
});

app.use("/api/v1", v1Router);
app.use(httpBodyErrorHandler);

export const createHttpServer = () => {
  const server = http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }, app);

  server.on("clientError", (error, socket) => {
    const clientError = error as Error & { code?: string };

    if (clientError.code !== "HPE_HEADER_OVERFLOW") {
      socket.destroy();
      return;
    }

    if (!socket.writable) {
      socket.destroy();
      return;
    }

    const responseBody = JSON.stringify(headersTooLargeResponse);

    socket.end(
      [
        "HTTP/1.1 431 Request Header Fields Too Large",
        "Connection: close",
        "Content-Type: application/json; charset=utf-8",
        `Content-Length: ${Buffer.byteLength(responseBody)}`,
        "",
        responseBody,
      ].join("\r\n"),
    );
  });

  return server;
};

/* istanbul ignore next */
if (require.main === module) {
  createHttpServer().listen(PORT, () => {
    console.log(`StreamPay backend listening on http://localhost:${PORT}`);
  });
}

export default app;
