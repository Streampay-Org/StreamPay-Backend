import { Router, Request, Response } from "express";
import { db } from "../db";
import { env } from "../config/env";
import { sql } from "drizzle-orm";

const router = Router();

export interface HealthStatus {
  status: "ok" | "error";
  service: string;
  timestamp: string;
  details?: {
    database?: "healthy" | "unhealthy";
    rpc?: "healthy" | "unhealthy" | "disabled";
  };
}

/**
 * Pings the database with a simple query.
 */
export async function checkDatabase(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.HEALTH_CHECK_TIMEOUT_MS);

    // Using raw SQL for the simplest possible ping
    await db.execute(sql`SELECT 1`);
    
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    console.error("Health Check: Database ping failed", error);
    return false;
  }
}

/**
 * Pings the Soroban RPC with a light request.
 */
export async function checkRPC(): Promise<boolean> {
  if (!env.RPC_PROBE_ENABLED) return true;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(env.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getNetwork",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    console.error("Health Check: RPC ping failed", error);
    return false;
  }
}

const getHealthStatus = async (deep: boolean): Promise<{ status: HealthStatus; statusCode: number }> => {
  const health: HealthStatus = {
    status: "ok",
    service: "streampay-backend",
    timestamp: new Date().toISOString(),
  };

  let isHealthy = true;

  if (deep) {
    const dbHealthy = await checkDatabase();
    const rpcHealthy = await checkRPC();

    health.details = {
      database: dbHealthy ? "healthy" : "unhealthy",
      rpc: env.RPC_PROBE_ENABLED ? (rpcHealthy ? "healthy" : "unhealthy") : "disabled",
    };

    if (!dbHealthy || (env.RPC_PROBE_ENABLED && !rpcHealthy)) {
      isHealthy = false;
      health.status = "error";
    }
  }

  return {
    status: health,
    statusCode: isHealthy ? 200 : 503,
  };
};

router.get("/", async (req: Request, res: Response) => {
  const deep = req.query.deep === "1" || req.query.deep === "true";
  const { status, statusCode } = await getHealthStatus(deep);
  res.status(statusCode).json(status);
});

router.get("/ready", async (_req: Request, res: Response) => {
  const { status, statusCode } = await getHealthStatus(true);
  res.status(statusCode).json(status);
});

export default router;
