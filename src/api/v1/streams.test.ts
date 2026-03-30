import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";
import { AuditService } from "../../services/auditService";

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

  describe("POST /api/v1/streams/:id/admin/pause", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    beforeEach(() => {
      process.env.JWT_SECRET = "test_shared_admin_secret_123456789012";
    });

    it("should return 401 when request is unauthorized", async () => {
      const response = await request(app).post(`/api/v1/streams/${validId}/admin/pause`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });

    it("should write an audit row on successful protected action", async () => {
      const mockStream = { id: validId, status: "paused" };
      const updateSpy = jest
        .spyOn(StreamRepository.prototype, "updateStatus")
        .mockResolvedValue(mockStream as never);
      const auditSpy = jest
        .spyOn(AuditService.prototype, "logSensitiveAction")
        .mockResolvedValue({ id: "audit-1" } as never);

      const response = await request(app)
        .post(`/api/v1/streams/${validId}/admin/pause`)
        .set("Authorization", `Bearer ${process.env.JWT_SECRET}`)
        .set("x-actor-id", "admin-user");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: validId, status: "paused" });
      expect(updateSpy).toHaveBeenCalledWith(validId, "paused");
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "admin-user",
          action: "stream_admin_action",
          streamId: validId,
        }),
      );

      updateSpy.mockRestore();
      auditSpy.mockRestore();
    });
  });
});
