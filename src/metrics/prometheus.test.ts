import request from "supertest";
import express, { Request, Response } from "express";
import { metricsMiddleware, metricsHandler, setSyncLag } from "./prometheus";

describe("Prometheus Metrics", () => {
  let app: express.Express;
  const originalEnv = process.env.NODE_ENV;
  const originalToken = process.env.PROMETHEUS_AUTH_TOKEN;

  beforeAll(() => {
    app = express();
    app.get("/metrics", metricsHandler); // Placed before middleware to skip metrics on itself
    app.use(metricsMiddleware);
    app.get("/test", (_req: Request, res: Response) => {
      res.status(200).send("ok");
    });
    app.get("/test/:id", (_req: Request, res: Response) => {
      res.status(500).send("error");
    });
    // Unknown route deliberately not handled, resulting in 404
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.PROMETHEUS_AUTH_TOKEN = originalToken;
  });

  it("exposes /metrics endpoint returning 200 and text format", async () => {
    process.env.NODE_ENV = "test";
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
  });

  it("protects /metrics endpoint in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PROMETHEUS_AUTH_TOKEN = "secret123";

    const resNoAuth = await request(app).get("/metrics");
    expect(resNoAuth.status).toBe(401);

    const resWrongAuth = await request(app).get("/metrics").set("Authorization", "Bearer wrong");
    expect(resWrongAuth.status).toBe(401);

    const resValid = await request(app).get("/metrics").set("Authorization", "Bearer secret123");
    expect(resValid.status).toBe(200);
  });

  it("protects /metrics endpoint in production even if token env var is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PROMETHEUS_AUTH_TOKEN;

    const resNoAuth = await request(app).get("/metrics").set("Authorization", "Bearer somesecret");
    expect(resNoAuth.status).toBe(401);
  });

  it("records HTTP latency, error rate, and normalizes unknown routes", async () => {
    process.env.NODE_ENV = "test";

    await request(app).get("/test");
    await request(app).get("/test/123");
    await request(app).get("/unknown/path/456");

    const res = await request(app).get("/metrics");
    const metricsStr = res.text as string;

    // Check successful route (200)
    expect(metricsStr).toContain('route="/test"');
    expect(metricsStr).toContain('status_code="200"');

    // Check error route (500)
    expect(metricsStr).toContain('route="/test/:id"');
    expect(metricsStr).toContain('status_code="500"');

    // Check unknown route (should normalize to /unknown_route or similar)
    expect(metricsStr).toContain('route="/unknown_route"');
    expect(metricsStr).toContain('status_code="404"');
  });

  it("records custom sync lag gauge", async () => {
    process.env.NODE_ENV = "test";
    setSyncLag("test_job", 42);

    const res = await request(app).get("/metrics");
    // e.g. job_sync_lag_seconds{job_name="test_job"} 42
    expect(res.text).toContain("job_sync_lag_seconds");
    expect(res.text).toContain('job_name="test_job"');
    expect(res.text).toContain("42");
  });
});
