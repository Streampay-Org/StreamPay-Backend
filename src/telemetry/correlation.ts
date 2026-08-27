import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { NextFunction, Request, Response } from "express";

const correlationStorage = new AsyncLocalStorage<string>();
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

/** Return a bounded, log-safe caller ID or create one for this operation. */
export function resolveCorrelationId(candidate: unknown): string {
  return typeof candidate === "string" && correlationIdPattern.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

/** Attach one correlation ID to the request, response, and async call chain. */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = resolveCorrelationId(req.header("x-correlation-id"));
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  correlationStorage.run(correlationId, () => next());
}

const safeFieldNames = new Set([
  "correlationId", "eventId", "eventType", "streamId", "dependency", "operation",
  "outcome", "status", "attempt", "durationMs", "errorCode",
]);

/** Emit structured diagnostics using an explicit allowlist; secrets/payloads never enter logs. */
export function logStructured(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const safeFields: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!safeFieldNames.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      safeFields[key] = value as string | number | boolean;
    }
  }
  console[level](JSON.stringify({ event, ...safeFields }));
}
