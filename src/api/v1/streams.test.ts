import request from "supertest";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";
import { Stream } from "../../db/schema";

const TEST_SECRET = "test-jwt-secret-that-is-at-least-32-chars!!";

// Inject JWT_SECRET so the requireAuth middleware has something to check against
beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe("Stream API Routes", () => {
  beforeAll(() => {
    process.env.API_KEYS = "test-1234";
    refreshApiKeyStore();
  });

  afterAll(() => {
    delete process.env.API_KEYS;
  });

  describe("GET /api/v1/streams/:id", () => {
    const validId = "123e4567-e89b-12d3-a456-426614174000";

    it("should return 200 and the stream when found", async () => {
      const mockStream = { id: validId, payer: "p1", accruedEstimate: "10.5" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockStream as any);

      const response = await request(app).get(`/api/v1/streams/${validId}`).set("x-api-key", "test-1234");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockStream);
      spy.mockRestore();
    });

    it("should return 404 when stream is not found", async () => {
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(null);

      const response = await request(app).get(`/api/v1/streams/${validId}`).set("x-api-key", "test-1234");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      spy.mockRestore();
    });

    it("should return 400 when ID is invalid", async () => {
      const response = await request(app)
        .get("/api/v1/streams/invalid-id")
        .set("x-api-key", "test-1234");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid stream ID format");
    });

    it("should allow includeDeleted for get by id", async () => {
      const mockStream = { id: validId, payer: "p1", accruedEstimate: "10.5" };
      const spy = jest.spyOn(StreamRepository.prototype, "findById").mockResolvedValue(mockStream as never);

      const response = await request(app)
        .get(`/api/v1/streams/${validId}?includeDeleted=true`)
        .set("x-api-key", "test-1234");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockStream);
      expect(spy).toHaveBeenCalledWith(validId, true);
      spy.mockRestore();
    });

    it("soft-deletes stream with DELETE", async () => {
      const spy = jest.spyOn(StreamRepository.prototype, "softDeleteById").mockResolvedValue(true);

      const response = await request(app)
        .delete(`/api/v1/streams/${validId}`)
        .set("x-api-key", "test-1234");

      expect(response.status).toBe(204);
      expect(spy).toHaveBeenCalledWith(validId);
      spy.mockRestore();
    });

    it("returns 404 when delete target not found", async () => {
      const spy = jest.spyOn(StreamRepository.prototype, "softDeleteById").mockResolvedValue(false);

      const response = await request(app)
        .delete(`/api/v1/streams/${validId}`)
        .set("x-api-key", "test-1234");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      spy.mockRestore();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue(mockResult as any);

      const response = await request(app).get("/api/v1/streams?payer=p1").set("x-api-key", "test-1234");

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

// ---------------------------------------------------------------------------
// CSV Export endpoint
// ---------------------------------------------------------------------------

const makeExportStream = (overrides: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-1111-1111-1111-000000000001",
  payer: "0xPayerAddress",
  recipient: "0xRecipientAddress",
  status: "active",
  ratePerSecond: "0.001",
  startTime: new Date("2024-01-01T00:00:00Z"),
  endTime: null,
  totalAmount: "3600.0",
  lastSettledAt: new Date("2024-01-01T00:00:00Z"),
  createdAt: new Date("2024-06-01T12:00:00Z"),
  updatedAt: new Date("2024-06-01T12:00:00Z"),
  ...overrides,
});

describe("GET /api/v1/streams/export.csv", () => {
  describe("authentication", () => {
    it("should return 401 when no Authorization header is present", async () => {
      const response = await request(app).get("/api/v1/streams/export.csv");
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });

    it("should return 401 when the token is wrong", async () => {
      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", "Bearer wrong-token");
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });

    it("should return 401 when Authorization header is malformed (no Bearer prefix)", async () => {
      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", TEST_SECRET);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });
  });

  describe("response format", () => {
    it("should return Content-Type text/csv for a valid request", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/csv/);
      spy.mockRestore();
    });

    it("should set Content-Disposition to attachment with a .csv filename", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(response.headers["content-disposition"]).toMatch(/attachment/);
      expect(response.headers["content-disposition"]).toMatch(/\.csv/);
      spy.mockRestore();
    });

    it("should include a header row in the CSV", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      const lines = response.text.split("\r\n").filter(Boolean);
      expect(lines[0]).toBe(
        "id,payer,recipient,status,ratePerSecond,startTime,endTime,totalAmount,lastSettledAt,createdAt,updatedAt"
      );
      spy.mockRestore();
    });
  });

  describe("row count and content", () => {
    it("should return only the header row when there are no streams", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      const lines = response.text.split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(1); // header only
      spy.mockRestore();
    });

    it("should contain one data row per stream in the fixture", async () => {
      const fixtures = [makeExportStream(), makeExportStream({ id: "bbbbbbbb-2222-2222-2222-000000000002" })];
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: fixtures as never[], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      const lines = response.text.split("\r\n").filter(Boolean);
      // 1 header + 2 data rows
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain(fixtures[0].id);
      expect(lines[2]).toContain(fixtures[1].id);
      spy.mockRestore();
    });

    it("should accumulate rows across multiple cursor pages", async () => {
      const page1 = [makeExportStream({ id: "id-page1" })];
      const page2 = [makeExportStream({ id: "id-page2" })];
      const cursor = { createdAt: new Date(), id: "id-page1" };

      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValueOnce({ rows: page1 as never[], nextCursor: cursor })
        .mockResolvedValueOnce({ rows: page2 as never[], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      const lines = response.text.split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(3); // header + 2 rows across 2 pages
      expect(response.text).toContain("id-page1");
      expect(response.text).toContain("id-page2");
      spy.mockRestore();
    });
  });

  describe("CSV content correctness", () => {
    it("should properly escape fields containing commas", async () => {
      const streamWithComma = makeExportStream({ payer: "address,with,commas" });
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [streamWithComma as never], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(response.text).toContain('"address,with,commas"');
      spy.mockRestore();
    });

    it("should properly escape fields containing double quotes", async () => {
      const streamWithQuote = makeExportStream({ recipient: 'has"quote' });
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [streamWithQuote as never], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(response.text).toContain('"has""quote"');
      spy.mockRestore();
    });

    it("should output empty string for null endTime", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [makeExportStream({ endTime: null }) as never], nextCursor: null });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      // The endTime column (6th, 0-indexed) should be empty between commas
      const dataLine = response.text.split("\r\n")[1];
      const cols = dataLine.split(",");
      expect(cols[6]).toBe(""); // endTime column
      spy.mockRestore();
    });
  });

  describe("query filter pass-through", () => {
    it("should forward payer, recipient, and status filters to the repository", async () => {
      const spy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({ rows: [], nextCursor: null });

      await request(app)
        .get("/api/v1/streams/export.csv?payer=0xA&recipient=0xB&status=paused")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ payer: "0xA", recipient: "0xB", status: "paused" })
      );
      spy.mockRestore();
    });
  });
});
