import request from "supertest";
import app from "../index";
import { StreamRepository } from "../repositories/streamRepository";

// Mock the StreamRepository to isolate the API layer
jest.mock("../repositories/streamRepository");

describe("Streams API", () => {
  const mockStreamRepository = StreamRepository.prototype as jest.Mocked<StreamRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/v1/streams/:id", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    it("should return 200 and the stream when found", async () => {
      const mockStream = {
        id: validId,
        payer: "0x123",
        recipient: "0x456",
        status: "active",
        ratePerSecond: "0.1",
        lastSettledAt: new Date().toISOString(),
        accruedEstimate: "10.5",
      };
      mockStreamRepository.findById.mockResolvedValue(mockStream as unknown as Awaited<ReturnType<StreamRepository["findById"]>>);

      const response = await request(app).get(`/api/v1/streams/${validId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockStream);
      expect(mockStreamRepository.findById).toHaveBeenCalledWith(validId);
    });

    it("should return 404 when stream is not found", async () => {
      mockStreamRepository.findById.mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/streams/${validId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
    });

    it("should return 500 when repository throws an error", async () => {
      mockStreamRepository.findById.mockRejectedValue(new Error("DB Error"));

      const response = await request(app).get(`/api/v1/streams/${validId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Internal server error");
    });

    // Table-driven validation tests
    describe("Validation Errors", () => {
      const invalidCases = [
        { id: "not-a-uuid", description: "non-UUID string" },
        { id: "123", description: "short string" },
        { id: "g23e4567-e89b-12d3-a456-426614174000", description: "invalid characters" },
        { id: "123e4567-e89b-12d3-a456-42661417400", description: "short UUID" },
      ];

      test.each(invalidCases)("should return 400 for $description", async ({ id }) => {
        const response = await request(app).get(`/api/v1/streams/${id}`);
        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Invalid stream ID format");
      });
    });
  });

  describe("GET /api/v1/streams", () => {
    it("should return 200 and a list of streams", async () => {
      const mockResult = {
        streams: [
          { id: "1", payer: "0x123", status: "active" },
          { id: "2", payer: "0x123", status: "paused" },
        ],
        total: 2,
        limit: 20,
        offset: 0,
      };
      mockStreamRepository.findAll.mockResolvedValue(mockResult as unknown as ReturnType<StreamRepository["findAll"]>);

      const response = await request(app).get("/api/v1/streams?payer=0x123");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(mockStreamRepository.findAll).toHaveBeenCalledWith(expect.objectContaining({
        payer: "0x123",
      }));
    });

    it("should handle all query parameters correctly", async () => {
      mockStreamRepository.findAll.mockResolvedValue({ streams: [], total: 0, limit: 10, offset: 5 });

      const response = await request(app)
        .get("/api/v1/streams")
        .query({
          payer: "p1",
          recipient: "r1",
          status: "active",
          limit: "10",
          offset: "5",
        });

      expect(response.status).toBe(200);
      expect(mockStreamRepository.findAll).toHaveBeenCalledWith({
        payer: "p1",
        recipient: "r1",
        status: "active",
        limit: 10,
        offset: 5,
      });
    });

    it("should return 500 when repository throws an error", async () => {
      mockStreamRepository.findAll.mockRejectedValue(new Error("DB Error"));

      const response = await request(app).get("/api/v1/streams");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Internal server error");
    });
  });
});
