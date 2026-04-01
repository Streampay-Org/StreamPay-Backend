import request from "supertest";
import app from "./index";
import { StreamRepository } from "./repositories/streamRepository";
import { refreshApiKeyStore } from "./middleware/apiKeyAuth";

describe("StreamPay Backend", () => {
  beforeAll(() => {
    process.env.API_KEYS = "test-1234";
    refreshApiKeyStore();

    jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue({
      streams: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  afterAll(() => {
    delete process.env.API_KEYS;
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

  describe("GET /api/v1/streams", () => {
    it("returns streams list", async () => {
      const res = await request(app).get("/api/v1/streams").set("x-api-key", "test-1234");
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
