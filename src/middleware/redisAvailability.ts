import { NextFunction, Request, Response } from "express";
import { getRedisClient } from "../cache/redis";

/** Parse the explicit fail-closed switch without treating arbitrary text as true. */
export const redisMutationsRequired = (): boolean => {
  const value = process.env.REDIS_REQUIRED_FOR_MUTATIONS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
};

/**
 * Fail closed for configured protected mutations when Redis cannot be reached.
 *
 * This middleware is intentionally opt-in: deployments that use Redis only as
 * an optional cache keep the existing availability behavior. Once enabled,
 * an outage returns 503 before the handler can mutate a record or enqueue work.
 */
export const requireRedisForMutation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!redisMutationsRequired() || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const redis = await getRedisClient();
  if (!redis) {
    res.status(503).json({
      error: "redis_unavailable",
      message: "This protected mutation is temporarily unavailable while Redis is recovering.",
      retryable: true,
    });
    return;
  }

  next();
};
