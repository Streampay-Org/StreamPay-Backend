import { Request, Response, NextFunction } from "express";
import client from "prom-client";

// Create a Registry
export const register = new client.Registry();

// Add default metrics (CPU, Memory, etc.)
client.collectDefaultMetrics({ register });

// Standard HTTP duration histogram
export const httpRequestDurationMicroseconds = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [10, 50, 100, 300, 500, 1000, 3000, 5000],
});

register.registerMetric(httpRequestDurationMicroseconds);

// Custom Gauge for sync lag
export const syncLagGauge = new client.Gauge({
  name: "job_sync_lag_seconds",
  help: "Lag of background jobs/syncs in seconds",
  labelNames: ["job_name"],
});

register.registerMetric(syncLagGauge);

/**
 * Middleware to track HTTP request duration and error rates.
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();

  res.on("finish", () => {
    // Calculate elapsed time in ms
    const diff = process.hrtime(start);
    const timeMs = diff[0] * 1e3 + diff[1] * 1e-6;

    // Normalize route to avoid high cardinality (group params)
    let route = req.path;
    if (req.route && req.route.path) {
      // req.route.path represents the matched route pattern e.g., '/test/:id'
      route = req.route.path;
      // If the app uses sub-routers, req.baseUrl contains the mounted path
      if (req.baseUrl) {
         route = req.baseUrl + (route === "/" ? "" : route);
      }
    } else {
      // Unmatched route or static file
      route = "/unknown_route";
    }

    httpRequestDurationMicroseconds
      .labels(req.method, route, res.statusCode.toString())
      .observe(timeMs);
  });

  next();
};

/**
 * Express handler for exposing /metrics endpoint.
 * Protected by bearer token in production.
 */
export const metricsHandler = async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.PROMETHEUS_AUTH_TOKEN;

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      res.status(401).send("Unauthorized");
      return;
    }
  }

  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};

/**
 * Helper to update sync lag gauge from worker/job code
 */
export const setSyncLag = (jobName: string, lagSeconds: number) => {
  syncLagGauge.labels(jobName).set(lagSeconds);
};
