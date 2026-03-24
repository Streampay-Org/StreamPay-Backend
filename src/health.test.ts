import request from "supertest";
import app from "./index";
import { StreamRepository } from "./repositories/streamRepository";

describe("StreamPay Backend", () => {
  beforeAll(() => {
    jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue({
      streams: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
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
      const res = await request(app).get("/api/v1/streams");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("streams");
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.streams)).toBe(true);
    });
  });
});
