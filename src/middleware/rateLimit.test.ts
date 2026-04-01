/**
 * Tests for rate limiting middleware.
 *
 * Uses RATE_LIMIT_ENABLED=true to opt-in to rate limiting in the test environment,
 * and short windows/low max values to trigger 429s quickly.
 */

import request from "supertest";
import express, { Request, Response } from "express";
import { createGlobalRateLimiter, createAuthRateLimiter } from "./rateLimit";

/** Build a minimal Express app with the given limiter applied. */
const buildApp = (limiter: ReturnType<typeof createGlobalRateLimiter>) => {
  const app = express();
  app.use(limiter);
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));
  return app;
};

describe("Rate Limiting Middleware", () => {
  // Enable rate limiting for all tests in this suite
  beforeAll(() => {
    process.env.RATE_LIMIT_ENABLED = "true";
  });

  afterAll(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  describe("createGlobalRateLimiter", () => {
    it("allows requests under the limit", async () => {
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 5 }));
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("returns 429 when limit is exceeded", async () => {
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 2 }));

      await request(app).get("/test");
      await request(app).get("/test");
      const res = await request(app).get("/test"); // 3rd request — over limit

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Too Many Requests");
      expect(res.body.message).toMatch(/rate limit exceeded/i);
    });

    it("includes RateLimit headers in the response", async () => {
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 10 }));
      const res = await request(app).get("/test");

      // draft-7 uses a combined RateLimit header
      expect(res.headers).toHaveProperty("ratelimit");
      expect(res.headers["ratelimit"]).toMatch(/limit=/);
    });

    it("includes Retry-After header on 429 response", async () => {
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 1 }));

      await request(app).get("/test"); // consume the only allowed request
      const res = await request(app).get("/test");

      expect(res.status).toBe(429);
      // draft-7 uses ratelimit-reset, but express-rate-limit also sets retry-after
      expect(
        res.headers["retry-after"] ?? res.headers["ratelimit-reset"]
      ).toBeDefined();
    });

    it("keys by X-API-Key header when present", async () => {
      // Two different API keys should have independent counters
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 1 }));

      const res1 = await request(app).get("/test").set("x-api-key", "key-alpha");
      const res2 = await request(app).get("/test").set("x-api-key", "key-beta");

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200); // different key — independent counter
    });

    it("blocks the same API key after limit is exceeded", async () => {
      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 1 }));

      await request(app).get("/test").set("x-api-key", "key-gamma");
      const res = await request(app).get("/test").set("x-api-key", "key-gamma");

      expect(res.status).toBe(429);
    });
  });

  describe("createAuthRateLimiter", () => {
    it("allows requests under the stricter auth limit", async () => {
      const app = buildApp(createAuthRateLimiter({ windowMs: 5_000, max: 3 }));
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    });

    it("returns 429 when auth limit is exceeded", async () => {
      const app = buildApp(createAuthRateLimiter({ windowMs: 5_000, max: 2 }));

      await request(app).get("/test");
      await request(app).get("/test");
      const res = await request(app).get("/test");

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Too Many Requests");
    });
  });

  describe("skip behaviour in test environment", () => {
    it("skips rate limiting when RATE_LIMIT_ENABLED is not set", async () => {
      delete process.env.RATE_LIMIT_ENABLED;

      const app = buildApp(createGlobalRateLimiter({ windowMs: 5_000, max: 1 }));

      // Both requests should succeed because the limiter is skipped
      await request(app).get("/test");
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);

      // Restore for remaining tests
      process.env.RATE_LIMIT_ENABLED = "true";
    });
  });
});
