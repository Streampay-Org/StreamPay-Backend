/**
 * Rate limiting middleware for StreamPay API.
 *
 * Provides two limiters:
 *  - `globalRateLimiter`  — applied to all routes (IP-based)
 *  - `authRateLimiter`    — stricter limiter for auth/sensitive endpoints
 *
 * Limits are configurable via environment variables (see src/config/env.ts).
 * All limiters return HTTP 429 with a `Retry-After` header when the limit is exceeded.
 */

import rateLimit, { ipKeyGenerator, RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response } from "express";

/** Resolve the key used for rate limiting.
 *  Priority: X-API-Key header → IP address (IPv6-safe via ipKeyGenerator).
 */
const keyGenerator = (req: Request): string => {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return `apikey:${apiKey}`;
  }
  const ip = req.ip ?? "unknown";
  return `ip:${ipKeyGenerator(ip)}`;
};

/** Standard handler that adds Retry-After and returns 429. */
const onLimitReached = (_req: Request, res: Response): void => {
  res.status(429).json({
    error: "Too Many Requests",
    message: "Rate limit exceeded. Please wait before retrying.",
  });
};

/**
 * Global rate limiter — applied to all API routes.
 *
 * Defaults (overridable via env):
 *   RATE_LIMIT_WINDOW_MS   = 60_000  (1 minute)
 *   RATE_LIMIT_MAX         = 100     (requests per window)
 */
export const createGlobalRateLimiter = (options?: {
  windowMs?: number;
  max?: number;
}): RateLimitRequestHandler => {
  const windowMs =
    options?.windowMs ??
    Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const max =
    options?.max ??
    Number(process.env.RATE_LIMIT_MAX ?? 100);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7", // Sends RateLimit-* headers (includes Retry-After)
    legacyHeaders: false,
    keyGenerator,
    handler: onLimitReached,
    skip: () => process.env.NODE_ENV === "test" && !process.env.RATE_LIMIT_ENABLED,
  });
};

/**
 * Auth rate limiter — stricter limits for authentication / sensitive endpoints.
 *
 * Defaults (overridable via env):
 *   RATE_LIMIT_AUTH_WINDOW_MS  = 900_000  (15 minutes)
 *   RATE_LIMIT_AUTH_MAX        = 20       (requests per window)
 */
export const createAuthRateLimiter = (options?: {
  windowMs?: number;
  max?: number;
}): RateLimitRequestHandler => {
  const windowMs =
    options?.windowMs ??
    Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? 900_000);
  const max =
    options?.max ??
    Number(process.env.RATE_LIMIT_AUTH_MAX ?? 20);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator,
    handler: onLimitReached,
    skip: () => process.env.NODE_ENV === "test" && !process.env.RATE_LIMIT_ENABLED,
  });
};

// Singleton instances used by the application
export const globalRateLimiter = createGlobalRateLimiter();
export const authRateLimiter = createAuthRateLimiter();
