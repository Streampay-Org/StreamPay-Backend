import request from "supertest";
import app from "./index";
import { db } from "./db";
import { env } from "./config/env";

// Mock the database
jest.mock("./db", () => ({
  db: {
    execute: jest.fn(),
  },
}));

// Mock the environment config
jest.mock("./config/env", () => ({
  env: {
    RPC_URL: "https://rpc.example.com",
    RPC_PROBE_ENABLED: false,
    HEALTH_CHECK_TIMEOUT_MS: 1000,
  },
}));

// Mock global fetch
global.fetch = jest.fn() as jest.Mock;

describe("Health Check Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).RPC_PROBE_ENABLED = false; // Reset to default
  });

  describe("GET /health", () => {
    it("returns 200 and status ok (shallow check)", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ok", service: "streampay-backend" });
      expect(res.body.timestamp).toBeDefined();
      expect(db.execute).not.toHaveBeenCalled();
    });

    it("returns 200 and deep status when ?deep=1 and healthy", async () => {
      (db.execute as jest.Mock).mockResolvedValueOnce({});
      
      const res = await request(app).get("/health?deep=1");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.details.database).toBe("healthy");
      expect(res.body.details.rpc).toBe("disabled");
    });

    it("returns 503 when ?deep=1 and database is down", async () => {
      (db.execute as jest.Mock).mockRejectedValueOnce(new Error("DB Down"));
      
      const res = await request(app).get("/health?deep=1");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
      expect(res.body.details.database).toBe("unhealthy");
    });
  });

  describe("GET /health/ready", () => {
    it("always performs a deep check", async () => {
      (db.execute as jest.Mock).mockResolvedValueOnce({});
      
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.details).toBeDefined();
      expect(db.execute).toHaveBeenCalled();
    });

    it("checks RPC when enabled and healthy", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).RPC_PROBE_ENABLED = true;
      (db.execute as jest.Mock).mockResolvedValueOnce({});
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.details.rpc).toBe("healthy");
    });

    it("returns 503 when RPC is enabled and down", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).RPC_PROBE_ENABLED = true;
      (db.execute as jest.Mock).mockResolvedValueOnce({});
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
      expect(res.body.details.rpc).toBe("unhealthy");
    });
  });
});
