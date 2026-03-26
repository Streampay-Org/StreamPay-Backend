import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";

describe("Stream API Routes", () => {
  describe("GET /api/v1/streams/:id", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    it("should return 200 and the stream when found", async () => {
      const mockStream = { id: validId, payer: "p1", accruedEstimate: "10.5" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockStream as any);

      const response = await request(app).get(`/api/v1/streams/${validId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockStream);
      spy.mockRestore();
    });

    it("should return 404 when stream is not found", async () => {
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/streams/${validId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      spy.mockRestore();
    });

    it("should return 400 when ID is invalid", async () => {
      const response = await request(app).get("/api/v1/streams/invalid-id");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid stream ID format");
    });
  });

  describe("GET /api/v1/streams", () => {
    it("should return 200 and the list of streams", async () => {
      const mockResult = {
        streams: [{ id: "1", payer: "p1" }],
        total: 1,
        limit: 20,
        offset: 0,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue(mockResult as any);

      const response = await request(app).get("/api/v1/streams?payer=p1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ payer: "p1" }));
      spy.mockRestore();
    });
  });
});
