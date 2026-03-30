import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";

describe("Stream API Routes", () => {
  describe("GET /api/v1/streams/:id", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    it("should return 200 and the stream when found", async () => {
      const mockStream = { id: validId, payer: "p1", accruedEstimate: "10.5" };
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockStream as never);

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

  describe("POST /api/v1/streams", () => {
    const validBody = {
      payer: "GPAYER",
      recipient: "GRECIPIENT",
      ratePerSecond: "0.000001",
      startTime: "2026-01-01T00:00:00.000Z",
      totalAmount: "100.0",
    };

    it("should return 201 and the created stream", async () => {
      const created = { id: "123e4567-e89b-12d3-a456-426614174000", ...validBody, status: "active" };
      const spy = jest
        .spyOn(StreamRepository.prototype, "create")
        .mockResolvedValue(created as never);

      const response = await request(app)
        .post("/api/v1/streams")
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(created.id);
      expect(response.body.status).toBe("active");
      spy.mockRestore();
    });

    it("should return 400 when required fields are missing", async () => {
      const response = await request(app)
        .post("/api/v1/streams")
        .send({ payer: "GPAYER" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toHaveProperty("recipient");
    });

    it("should return 400 when ratePerSecond is not a decimal string", async () => {
      const response = await request(app)
        .post("/api/v1/streams")
        .send({ ...validBody, ratePerSecond: "not-a-number" });

      expect(response.status).toBe(400);
      expect(response.body.details).toHaveProperty("ratePerSecond");
    });

    it("should return 400 when startTime is not ISO-8601", async () => {
      const response = await request(app)
        .post("/api/v1/streams")
        .send({ ...validBody, startTime: "not-a-date" });

      expect(response.status).toBe(400);
      expect(response.body.details).toHaveProperty("startTime");
    });

    it("should return 500 when repository throws", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "create")
        .mockRejectedValue(new Error("DB error"));

      const response = await request(app)
        .post("/api/v1/streams")
        .send(validBody);

      expect(response.status).toBe(500);
      spy.mockRestore();
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
      const spy = jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue(mockResult as never);

      const response = await request(app).get("/api/v1/streams?payer=p1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ payer: "p1" }));
      spy.mockRestore();
    });
  });
});
