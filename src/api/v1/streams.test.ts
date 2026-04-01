import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";
import { Stream } from "../../db/schema";

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

  describe("PATCH /api/v1/streams/:id", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    it("should return 200 and updated stream on successful update", async () => {
      const updateData = { labels: ["test"], offChainMemo: "memo" };
      const mockUpdatedStream = { id: validId, ...updateData, accruedEstimate: "10.5" };
      const updateSpy = jest.spyOn(StreamRepository.prototype, "updateById").mockResolvedValue({ id: validId, ...updateData } as Stream);
      const findSpy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockUpdatedStream as Stream & { accruedEstimate: string });

      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUpdatedStream);
      expect(updateSpy).toHaveBeenCalledWith(validId, updateData, undefined);
      updateSpy.mockRestore();
      findSpy.mockRestore();
    });

    it("should return 404 when stream is not found", async () => {
      const updateSpy = jest.spyOn(StreamRepository.prototype, "updateById").mockResolvedValue(null);

      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ labels: ["test"] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found or update conflict");
      updateSpy.mockRestore();
    });

    it("should return 400 when ID is invalid", async () => {
      const response = await request(app)
        .patch("/api/v1/streams/invalid-id")
        .send({ labels: ["test"] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid stream ID format");
    });

    it("should return 400 when invalid fields are provided", async () => {
      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ invalidField: "value" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid fields: invalidField");
    });

    it("should return 400 when status is invalid", async () => {
      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ status: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid status value");
    });

    it("should return 400 when labels is not an array of strings", async () => {
      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ labels: "not an array" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Labels must be an array of strings");
    });

    it("should return 400 when offChainMemo is not a string or null", async () => {
      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ offChainMemo: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("offChainMemo must be a string or null");
    });

    it("should handle optimistic locking with updatedAt", async () => {
      const updateData = { labels: ["test"] };
      const updateSpy = jest.spyOn(StreamRepository.prototype, "updateById").mockResolvedValue(null); // Simulate conflict

      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .send({ ...updateData, updatedAt: "2023-01-01T00:00:00.000Z" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found or update conflict");
      expect(updateSpy).toHaveBeenCalledWith(validId, updateData, expect.any(Date));
      updateSpy.mockRestore();
    });
  });
});
