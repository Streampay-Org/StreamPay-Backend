/** Tenant and route-aware fixed-window rate limiting. */
import { Request, Response, NextFunction } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import client from "prom-client";
import { register } from "../metrics/prometheus";

export interface RateLimitBudget { windowMs: number; max: number; }
export interface RateLimitOverride extends RateLimitBudget {
  tenantId: string; route: string; actor: string; reason: string;
}
export interface RateLimitOptions extends Partial<RateLimitBudget> {
  routeBudgets?: Record<string, RateLimitBudget>;
}
interface Bucket { count: number; resetAt: number; }

const DEFAULT_GLOBAL: RateLimitBudget = { windowMs: 60_000, max: 100 };
const DEFAULT_AUTH: RateLimitBudget = { windowMs: 900_000, max: 20 };
const overrides = new Map<string, RateLimitOverride>();

export const rateLimitRequestsTotal = new client.Counter({
  name: "http_rate_limit_requests_total",
  help: "Requests evaluated by the tenant and route rate limiter.",
  labelNames: ["tenant", "route", "result"],
});
try { register.registerMetric(rateLimitRequestsTotal); } catch { /* already registered during a test reload */ }

/** Set an override only after the caller has authenticated an administrator. */
export const setRateLimitOverride = async (
  override: RateLimitOverride,
  audit: (override: RateLimitOverride) => void | Promise<void>,
): Promise<void> => {
  if (!override.tenantId || !override.route || !override.actor || !override.reason.trim()) {
    throw new Error("Rate-limit overrides require tenant, route, actor, and reason");
  }
  if (!Number.isInteger(override.max) || override.max < 1 || override.windowMs < 1) {
    throw new Error("Rate-limit overrides must use positive window and max values");
  }
  await audit(override);
  overrides.set(`${override.tenantId}:${override.route}`, { ...override });
};

export const clearRateLimitOverrides = (): void => overrides.clear();

const routePath = (req: Request): string => {
  if (req.route?.path && typeof req.route.path === "string") return `${req.baseUrl}${req.route.path}` || "/";
  return req.path || "/";
};

const tenantKey = (req: Request): string => {
  if (req.apiKey?.id) return req.apiKey.id;
  const user = req.user as { tenantId?: string; tenant_id?: string; sub?: string } | undefined;
  const tenant = user?.tenantId ?? user?.tenant_id ?? user?.sub;
  return tenant ?? `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
};

const routeMatches = (configured: string, actual: string): boolean => {
  if (configured === "*") return true;
  if (configured.endsWith("/*")) return actual.startsWith(configured.slice(0, -1));
  return configured === actual;
};

const matchingBudget = (budgets: Record<string, RateLimitBudget>, path: string): RateLimitBudget | undefined => {
  const match = Object.keys(budgets).filter((candidate) => routeMatches(candidate, path))
    .sort((a, b) => b.length - a.length)[0];
  return match ? budgets[match] : undefined;
};

const setHeaders = (res: Response, limit: number, remaining: number, resetAt: number): void => {
  const reset = Math.ceil(resetAt / 1000);
  res.setHeader("RateLimit", `limit=${limit}; remaining=${Math.max(0, remaining)}; reset=${reset}`);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(reset));
};

const createLimiter = (defaults: RateLimitBudget, options: RateLimitOptions = {}) => {
  const base = { windowMs: options.windowMs ?? defaults.windowMs, max: options.max ?? defaults.max };
  const budgets = options.routeBudgets ?? {};
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === "test" && !process.env.RATE_LIMIT_ENABLED) { next(); return; }
    const tenant = tenantKey(req);
    const path = routePath(req);
    const routeBudget = matchingBudget(budgets, path) ?? base;
    const configuredRoute = Object.keys(budgets).filter((key) => routeMatches(key, path))
      .sort((a, b) => b.length - a.length)[0];
    const override = configuredRoute
      ? overrides.get(`${tenant}:${configuredRoute}`) ?? overrides.get(`${tenant}:${path}`)
      : overrides.get(`${tenant}:${path}`);
    const effectiveRoute = override ?? routeBudget;
    const now = Date.now();
    const consume = (key: string, budget: RateLimitBudget): Bucket => {
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + budget.windowMs };
        buckets.set(key, fresh);
        return fresh;
      }
      existing.count += 1;
      return existing;
    };
    const tenantBucket = consume(`${tenant}:tenant`, base);
    const routeBucket = consume(`${tenant}:route:${path}`, effectiveRoute);
    const remaining = Math.min(base.max - tenantBucket.count, effectiveRoute.max - routeBucket.count);
    const resetAt = Math.max(tenantBucket.resetAt, routeBucket.resetAt);
    setHeaders(res, Math.min(base.max, effectiveRoute.max), remaining, resetAt);
    const blocked = tenantBucket.count > base.max || routeBucket.count > effectiveRoute.max;
    rateLimitRequestsTotal.labels(tenant, path, blocked ? "blocked" : "allowed").inc();
    if (blocked) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      res.status(429).json({ error: "Too Many Requests", message: "Rate limit exceeded. Please wait before retrying." });
      return;
    }
    next();
  };
};

export const createGlobalRateLimiter = (options?: RateLimitOptions) => createLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_GLOBAL.windowMs),
  max: Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_GLOBAL.max),
}, options ?? { routeBudgets: readRouteBudgets() });
export const createAuthRateLimiter = (options?: RateLimitOptions) => createLimiter({
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? DEFAULT_AUTH.windowMs),
  max: Number(process.env.RATE_LIMIT_AUTH_MAX ?? DEFAULT_AUTH.max),
}, options);
export const globalRateLimiter = createGlobalRateLimiter();
export const authRateLimiter = createAuthRateLimiter();

function readRouteBudgets(): Record<string, RateLimitBudget> {
  const value = process.env.RATE_LIMIT_ROUTE_BUDGETS;
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, RateLimitBudget>;
  } catch {
    throw new Error("RATE_LIMIT_ROUTE_BUDGETS must be a JSON object of route budgets");
  }
}
