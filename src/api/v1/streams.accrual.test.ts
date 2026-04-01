import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";
import { accrualService } from "../../services/accrualService";

describe("Stream Accrual Preview API", () => {
  const validId = "123e4567-e89b-12d3-a456-426614174000";

  describe("GET /api/v1/streams/:id/accrual-preview", () => {
    it("should return 200 and the accrual preview when found", async () => {
      const mockStream = { 
        id: validId, 
        payer: "p1", 
        status: "active",
        lastSettledAt: new Date().toISOString(),
        ratePerSecond: "1.0"
      };
      
      const mockResult = {
        streamId: validId,
        accruedAmount: "10.000000000",
        calculationTimestamp: new Date(),
        status: "active"
      };

      const repoSpy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockStream as never);
      const serviceSpy = jest.spyOn(accrualService, "calculateAccrual").mockReturnValue(mockResult as never);

      const response = await request(app).get(`/api/v1/streams/${validId}/accrual-preview`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({
        streamId: validId,
        accruedAmount: "10.000000000",
        status: "active",
      }));
      expect(response.body).toHaveProperty("disclaimer");
      expect(response.body).toHaveProperty("note");

      repoSpy.mockRestore();
      serviceSpy.mockRestore();
    });

    it("should return 404 when stream is not found", async () => {
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/streams/${validId}/accrual-preview`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      spy.mockRestore();
    });

    it("should return 400 when ID is invalid", async () => {
      const response = await request(app).get("/api/v1/streams/invalid-id/accrual-preview");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid stream ID format");
    });
  });
});
