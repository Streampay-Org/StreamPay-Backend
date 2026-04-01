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
    it("returns 200 and status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ok", service: "streampay-backend" });
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe("GET /api/v1/streams", () => {
    it("returns streams list", async () => {
      const res = await request(app).get("/api/v1/streams").set("x-api-key", "test-1234");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("streams");
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.streams)).toBe(true);
    });
  });
});
