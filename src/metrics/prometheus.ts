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

export const dependencyOperationsTotal = new client.Counter({
  name: "streampay_dependency_operations_total",
  help: "Dependency operations grouped by bounded dependency and outcome.",
  labelNames: ["dependency", "operation", "outcome"],
});
register.registerMetric(dependencyOperationsTotal);

export const indexerEventsTotal = new client.Counter({
  name: "streampay_indexer_events_total",
  help: "Indexer webhook events grouped by bounded event type and outcome.",
  labelNames: ["event_type", "outcome"],
});
register.registerMetric(indexerEventsTotal);

export function recordDependencyOperation(
  dependency: string,
  operation: string,
  outcome: "success" | "failure" | "retry" | "dead_letter",
): void {
  dependencyOperationsTotal.labels(dependency, operation, outcome).inc();
}

/** 1 while the optional Redis dependency is healthy, 0 during an outage. */
export const redisAvailabilityGauge = new client.Gauge({
  name: "redis_availability",
  help: "Whether Redis is available to the backend (1=available, 0=unavailable).",
  labelNames: ["component"],
});

/** Counts Redis failures by component and outcome for alerting and recovery analysis. */
export const redisStateChangesTotal = new client.Counter({
  name: "redis_state_changes_total",
  help: "Redis availability failures and recoveries observed by backend components.",
  labelNames: ["component", "state"],
});

/** Counts worker lease decisions; skipped jobs are visible without exposing payloads. */
export const jobLeaseDecisionsTotal = new client.Counter({
  name: "job_lease_decisions_total",
  help: "Background job lease acquisition outcomes.",
  labelNames: ["result"],
});

redisAvailabilityGauge.labels("shared").set(0);
register.registerMetric(redisAvailabilityGauge);
register.registerMetric(redisStateChangesTotal);
register.registerMetric(jobLeaseDecisionsTotal);

export const markRedisAvailable = (component = "shared"): void => {
  redisAvailabilityGauge.labels(component).set(1);
};

export const markRedisUnavailable = (component = "shared"): void => {
  redisAvailabilityGauge.labels(component).set(0);
};

export const recordRedisStateChange = (state: "failure" | "recovery", component = "shared"): void => {
  redisStateChangesTotal.labels(component, state).inc();
  if (state === "recovery") markRedisAvailable(component);
  else markRedisUnavailable(component);
};

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
