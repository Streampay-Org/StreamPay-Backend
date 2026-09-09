import request from "supertest";
import { Request, Response } from "express";
import app from "../../index";
import { StreamRepository } from "../../repositories/streamRepository";
import { Stream } from "../../db/schema";
import { refreshApiKeyStore } from "../../middleware/apiKeyAuth";
import { AuditService } from "../../services/auditService";
import { tenantContextMiddleware } from "../../middleware/tenantContext";

const TEST_SECRET = "test-jwt-secret-that-is-at-least-32-chars!!";

describe("Multi-Tenant Isolation Integration Tests", () => {
  const validId = "123e4567-e89b-12d3-a456-426614174000";

  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.API_KEYS = "client-key,admin-key";
    refreshApiKeyStore();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.API_KEYS;
  });

  describe("Tenant Context Enforcement", () => {
    it("rejects unauthenticated requests missing credentials with 401", async () => {
      const response = await request(app).get("/api/v1/streams");
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("API key missing");
    });

    it("rejects empty tenant header with 400", async () => {
      const response = await request(app)
        .get("/api/v1/streams")
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "   ");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("invalid_tenant_id");
    });

    it("returns 401 when middleware encounters request missing tenant context", () => {
      const mockReq = {
        path: "/streams",
        header: jest.fn(() => undefined),
      } as unknown as Request;
      const jsonMock = jest.fn();
      const statusMock = jest.fn(() => ({ json: jsonMock }));
      const mockRes = {
        status: statusMock,
      } as unknown as Response;
      const nextMock = jest.fn();

      tenantContextMiddleware(mockReq, mockRes, nextMock);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: "tenant_context_required", code: "tenant_context_required" }),
      );
      expect(nextMock).not.toHaveBeenCalled();
    });

    it("returns 403 when middleware encounters unauthorized administrative bypass", () => {
      const mockReq = {
        path: "/streams",
        header: jest.fn((name: string) => (name === "x-admin-bypass" ? "true" : undefined)),
      } as unknown as Request;
      const jsonMock = jest.fn();
      const statusMock = jest.fn(() => ({ json: jsonMock }));
      const mockRes = {
        status: statusMock,
      } as unknown as Response;
      const nextMock = jest.fn();

      tenantContextMiddleware(mockReq, mockRes, nextMock);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: "unauthorized_bypass", code: "unauthorized_bypass" }),
      );
      expect(nextMock).not.toHaveBeenCalled();
    });
  });

  describe("Cross-Tenant Stream Creation", () => {
    it("rejects creation when body tenantId mismatches header tenantId", async () => {
      const response = await request(app)
        .post("/api/v1/streams")
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha")
        .send({
          tenantId: "tenant-beta",
          payer: "0x1111111111111111111111111111111111111111",
          recipient: "0x2222222222222222222222222222222222222222",
          ratePerSecond: "1.5",
          startTime: "2026-01-01T00:00:00.000Z",
          totalAmount: "100",
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Cannot create stream for another tenant");
    });

    it("assigns header tenantId to created stream", async () => {
      const mockCreated = {
        id: validId,
        tenantId: "tenant-alpha",
        payer: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        ratePerSecond: "1.5",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalAmount: "100",
        status: "active",
        lastSettledAt: new Date("2026-01-01T00:00:00.000Z"),
      };

      const createSpy = jest
        .spyOn(StreamRepository.prototype, "create")
        .mockResolvedValue(mockCreated as unknown as Stream);

      const response = await request(app)
        .post("/api/v1/streams")
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha")
        .send({
          payer: "0x1111111111111111111111111111111111111111",
          recipient: "0x2222222222222222222222222222222222222222",
          ratePerSecond: "1.5",
          startTime: "2026-01-01T00:00:00.000Z",
          totalAmount: "100",
        });

      expect(response.status).toBe(201);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-alpha" }),
      );
      createSpy.mockRestore();
    });
  });

  describe("Cross-Tenant Read Isolation", () => {
    it("returns 404 without leaking stream data when stream belongs to another tenant", async () => {
      const foreignStream = {
        id: validId,
        tenantId: "tenant-beta",
        payer: "0x1111",
        recipient: "0x2222",
        ratePerSecond: "1.0",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalAmount: "100.0",
        status: "active",
        lastSettledAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
        chainId: null,
        contractAddress: null,
        transactionHash: null,
        labels: null,
        offChainMemo: null,
        metadata: null,
        accruedEstimate: "0",
      };

      const findSpy = jest
        .spyOn(StreamRepository.prototype, "findById")
        .mockResolvedValue(foreignStream as unknown as Stream & { accruedEstimate: string });

      const response = await request(app)
        .get(`/api/v1/streams/${validId}`)
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      findSpy.mockRestore();
    });

    it("returns 404 for accrual-preview on cross-tenant stream", async () => {
      const foreignStream = {
        id: validId,
        tenantId: "tenant-beta",
        payer: "0x1111",
        recipient: "0x2222",
        ratePerSecond: "1.0",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalAmount: "100.0",
        status: "active",
        lastSettledAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
        chainId: null,
        contractAddress: null,
        transactionHash: null,
        labels: null,
        offChainMemo: null,
        metadata: null,
        accruedEstimate: "0",
      };

      const findSpy = jest
        .spyOn(StreamRepository.prototype, "findById")
        .mockResolvedValue(foreignStream as unknown as Stream & { accruedEstimate: string });

      const response = await request(app)
        .get(`/api/v1/streams/${validId}/accrual-preview`)
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found");
      findSpy.mockRestore();
    });
  });

  describe("Cross-Tenant Mutation Isolation", () => {
    it("returns 404 on PATCH when stream belongs to another tenant", async () => {
      const updateSpy = jest
        .spyOn(StreamRepository.prototype, "updateById")
        .mockResolvedValue(null);

      const response = await request(app)
        .patch(`/api/v1/streams/${validId}`)
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha")
        .send({ labels: ["confidential"] });

      expect(response.status).toBe(404);
      expect(updateSpy).toHaveBeenCalledWith(
        validId,
        { labels: ["confidential"] },
        undefined,
        "tenant-alpha",
      );
      updateSpy.mockRestore();
    });

    it("returns 404 on DELETE when stream belongs to another tenant", async () => {
      const deleteSpy = jest
        .spyOn(StreamRepository.prototype, "softDeleteById")
        .mockResolvedValue(false);

      const response = await request(app)
        .delete(`/api/v1/streams/${validId}`)
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(404);
      expect(deleteSpy).toHaveBeenCalledWith(validId, "tenant-alpha");
      deleteSpy.mockRestore();
    });

    it("returns 404 on restore when stream belongs to another tenant", async () => {
      const restoreSpy = jest
        .spyOn(StreamRepository.prototype, "restoreById")
        .mockResolvedValue(false);

      const response = await request(app)
        .post(`/api/v1/streams/${validId}/restore`)
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(404);
      expect(restoreSpy).toHaveBeenCalledWith(validId, "tenant-alpha");
      restoreSpy.mockRestore();
    });
  });

  describe("Cross-Tenant Query Filtering", () => {
    it("scopes findAll queries to tenantId and filters out foreign streams", async () => {
      const streams = [
        { id: validId, tenantId: "tenant-alpha", payer: "0x1" },
        { id: "22222222-2222-2222-2222-222222222222", tenantId: "tenant-beta", payer: "0x2" },
      ];

      const listSpy = jest
        .spyOn(StreamRepository.prototype, "findAll")
        .mockResolvedValue({
          streams: streams as unknown as Stream[],
          total: 2,
          offset: 0,
          limit: 20,
        });

      const response = await request(app)
        .get("/api/v1/streams")
        .set("x-api-key", "client-key")
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-alpha" }),
      );
      expect(response.body.streams).toHaveLength(1);
      expect(response.body.streams[0].tenantId).toBe("tenant-alpha");
      listSpy.mockRestore();
    });

    it("scopes export.csv queries to the authenticated tenant", async () => {
      const exportSpy = jest
        .spyOn(StreamRepository.prototype, "findForExport")
        .mockResolvedValue({
          rows: [
            {
              id: validId,
              tenantId: "tenant-alpha",
              payer: "0x1111",
              recipient: "0x2222",
              status: "active",
              ratePerSecond: "1.0",
              startTime: new Date("2026-01-01T00:00:00.000Z"),
              endTime: null,
              totalAmount: "100.0",
              lastSettledAt: new Date("2026-01-01T00:00:00.000Z"),
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              deletedAt: null,
              chainId: "1",
              contractAddress: null,
              transactionHash: null,
              labels: null,
              offChainMemo: null,
              metadata: null,
            },
          ],
          nextCursor: null,
        });

      const response = await request(app)
        .get("/api/v1/streams/export.csv")
        .set("authorization", `Bearer ${TEST_SECRET}`)
        .set("x-tenant-id", "tenant-alpha");

      expect(response.status).toBe(200);
      expect(exportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-alpha" }),
      );
      expect(response.text).toContain(validId);
      exportSpy.mockRestore();
    });
  });

  describe("Administrative Bypass & Audit Trail", () => {
    it("allows cross-tenant access and logs audit trail when admin bypass is active", async () => {
      const auditSpy = jest
        .spyOn(AuditService.prototype, "logSensitiveAction")
        .mockResolvedValue({
          id: "audit-1",
          createdAt: new Date(),
          actor: "admin-key",
          action: "stream_admin_action",
          streamId: validId,
          ipAddress: "127.0.0.1",
          metadata: {},
        });

      const foreignStream = {
        id: validId,
        tenantId: "tenant-beta",
        payer: "0x1111",
        recipient: "0x2222",
        ratePerSecond: "1.0",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalAmount: "100.0",
        status: "active",
        lastSettledAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
        chainId: null,
        contractAddress: null,
        transactionHash: null,
        labels: null,
        offChainMemo: null,
        metadata: null,
        accruedEstimate: "0",
      };

      const findSpy = jest
        .spyOn(StreamRepository.prototype, "findById")
        .mockResolvedValue(foreignStream as unknown as Stream & { accruedEstimate: string });

      const response = await request(app)
        .get(`/api/v1/streams/${validId}`)
        .set("x-api-key", "admin-key")
        .set("x-admin-bypass", "true")
        .set("x-bypass-reason", "regulatory_audit");

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(validId);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "stream_admin_action",
          streamId: validId,
          metadata: expect.objectContaining({
            bypass: true,
            reason: "regulatory_audit",
            operation: "read_stream",
          }),
        }),
      );

      auditSpy.mockRestore();
      findSpy.mockRestore();
    });
  });
});
