import cors from "cors";
import express from "express";
import request from "supertest";
import { createCorsOptions } from "./cors";

const createTestApp = (config: { NODE_ENV?: string; CORS_ALLOWED_ORIGINS?: string }) => {
  const app = express();

  app.use(cors(createCorsOptions(config)));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
};

describe("createCorsOptions", () => {
  it("allows preflight requests in development when allowlist is not set", async () => {
    const app = createTestApp({ NODE_ENV: "development" });

    const res = await request(app)
      .options("/health")
      .set("Origin", "https://frontend.local")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://frontend.local");
  });

  it("allows only configured origins in production", async () => {
    const app = createTestApp({
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://app.streampay.com, https://admin.streampay.com",
    });

    const allowed = await request(app)
      .options("/health")
      .set("Origin", "https://app.streampay.com")
      .set("Access-Control-Request-Method", "GET");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.streampay.com");

    const blocked = await request(app)
      .options("/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");

    expect(blocked.status).toBe(500);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects wildcard origins in production", () => {
    expect(() =>
      createCorsOptions({
        NODE_ENV: "production",
        CORS_ALLOWED_ORIGINS: "*",
      }),
    ).toThrow("wildcard");
  });

  it("requires explicit allowlist in production", () => {
    expect(() =>
      createCorsOptions({
        NODE_ENV: "production",
      }),
    ).toThrow("must be configured");
  });
});
