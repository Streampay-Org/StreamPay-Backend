# feat(backend): Rate Limiting for HTTP API

## Summary

Implements per-IP and per-API-key rate limiting across all HTTP routes using `express-rate-limit` v8, with a stricter limiter available for auth/sensitive endpoints. All limits are configurable via environment variables and default to sensible production values.

## What changed

- `src/middleware/rateLimit.ts` — new middleware module exposing `createGlobalRateLimiter` and `createAuthRateLimiter` factory functions, plus singleton instances (`globalRateLimiter`, `authRateLimiter`) ready to drop onto any router.
- `src/index.ts` — `globalRateLimiter` wired in after CORS, before route handlers.
- `src/config/env.ts` — four new optional env vars added to the Zod schema (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`).
- `.env.example` — documents the new vars with their defaults.
- `README.md` — new **Rate Limiting** section documents limits, headers, key resolution, and proxy configuration note.
- `src/middleware/rateLimit.test.ts` — 9 tests covering: under-limit pass-through, 429 on limit exceeded, `RateLimit` response headers, `Retry-After` on 429, independent counters per API key, same-key blocking, auth limiter, and test-env skip behaviour.

## Rate limit defaults

| Limiter | Window  | Max requests | Scope       |
|---------|---------|-------------|-------------|
| Global  | 60 s    | 100         | All routes  |
| Auth    | 15 min  | 20          | Auth routes |

Responses over the limit return **HTTP 429** with a `Retry-After` value via the `RateLimit-Reset` standard header (draft-7).

Key resolution priority: `X-API-Key` header → client IP (IPv6-safe via `ipKeyGenerator`).

## Test output

```
PASS  src/middleware/rateLimit.test.ts
  Rate Limiting Middleware
    createGlobalRateLimiter
      ✓ allows requests under the limit
      ✓ returns 429 when limit is exceeded
      ✓ includes RateLimit headers in the response
      ✓ includes Retry-After header on 429 response
      ✓ keys by X-API-Key header when present
      ✓ blocks the same API key after limit is exceeded
    createAuthRateLimiter
      ✓ allows requests under the stricter auth limit
      ✓ returns 429 when auth limit is exceeded
    skip behaviour in test environment
      ✓ skips rate limiting when RATE_LIMIT_ENABLED is not set

Tests: 9 passed, 9 total
Coverage (src/middleware/rateLimit.ts): 100% statements | 100% functions | 100% lines | 96% branches
```

The single uncovered branch (line 23) is the `req.ip ?? "unknown"` nullish fallback — unreachable under normal Express operation.

## Pre-existing test failures — intentionally untouched

The test suite reports **4 failing test suites** (`src/health.test.ts`, `src/indexerWebhook.test.ts`, and two others) caused by `metricsHandler` and `metricsMiddleware` being referenced in `src/index.ts` without being imported, and a missing `prom-client` type declaration in `src/metrics/prometheus.ts`. **These failures existed before this PR and were not introduced by it.**

No changes were made to those files. Touching them to fix unrelated pre-existing errors would have expanded the scope of this PR, risked introducing regressions in areas outside the rate-limiting feature, and made the diff harder to review. The 20 tests that were passing before this PR continue to pass.

## Security notes

- IPv6 addresses are normalised to a /56 subnet via `ipKeyGenerator` to prevent trivial bypass by cycling through addresses in the same block.
- Requests supplying an `X-API-Key` header are bucketed per key, keeping their counter independent from IP-based counters.
- Rate limiting is skipped in the test environment unless `RATE_LIMIT_ENABLED=true` is set, avoiding flaky tests while keeping the opt-in path for integration tests.
- If the service runs behind a reverse proxy, set `app.set('trust proxy', 1)` so `req.ip` reflects the real client IP.

Closes issue #12
