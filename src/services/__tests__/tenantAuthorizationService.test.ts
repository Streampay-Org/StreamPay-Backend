import { Request } from "express";
import {
  TenantAuthorizationService,
  TenantContext,
} from "../tenantAuthorizationService";
import { AuditService } from "../auditService";

describe("TenantAuthorizationService", () => {
  let mockAuditService: jest.Mocked<AuditService>;
  let service: TenantAuthorizationService;

  beforeEach(() => {
    mockAuditService = {
      logSensitiveAction: jest.fn().mockResolvedValue({ id: "audit-1" } as never),
    } as unknown as jest.Mocked<AuditService>;
    service = new TenantAuthorizationService(mockAuditService);
  });

  describe("extractTenantContext", () => {
    it("returns 400 when tenant header is present but empty", () => {
      const req = {
        header: jest.fn((name: string) => (name === "x-tenant-id" ? "   " : undefined)),
        ip: "127.0.0.1",
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context).toBeNull();
      expect(result.error).toEqual({
        status: 400,
        code: "invalid_tenant_id",
        message: "Tenant ID header cannot be empty",
      });
    });

    it("returns 403 when admin bypass is requested without credentials", () => {
      const req = {
        header: jest.fn((name: string) => (name === "x-admin-bypass" ? "true" : undefined)),
        ip: "127.0.0.1",
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context).toBeNull();
      expect(result.error).toEqual({
        status: 403,
        code: "unauthorized_bypass",
        message: "Administrative bypass requires authorized credentials",
      });
    });

    it("returns 401 when tenant identifier is missing and not an admin bypass", () => {
      const req = {
        header: jest.fn(() => undefined),
        ip: "127.0.0.1",
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context).toBeNull();
      expect(result.error).toEqual({
        status: 401,
        code: "tenant_context_required",
        message: "Tenant context is required",
      });
    });

    it("extracts context from x-tenant-id header with api key", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "x-tenant-id") return "tenant-alpha";
          if (name === "x-actor-id") return "actor-custom";
          return undefined;
        }),
        apiKey: { id: "key-123" },
        ip: "192.168.1.1",
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context).toEqual({
        tenantId: "tenant-alpha",
        actor: "key-123",
        isServiceBypass: false,
        isAdmin: false,
        ipAddress: "192.168.1.1",
        reason: undefined,
      });
    });

    it("extracts context from x-tenant alternate header", () => {
      const req = {
        header: jest.fn((name: string) => (name === "x-tenant" ? "tenant-beta" : undefined)),
        user: { sub: "user-sub-1" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.tenantId).toBe("tenant-beta");
      expect(result.context?.actor).toBe("user-sub-1");
    });

    it("extracts tenantId from user.tenantId if header is omitted", () => {
      const req = {
        header: jest.fn(() => undefined),
        user: { sub: "user-1", tenantId: "tenant-from-jwt" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.tenantId).toBe("tenant-from-jwt");
    });

    it("extracts tenantId from user.tenant_id if tenantId is omitted", () => {
      const req = {
        header: jest.fn(() => undefined),
        user: { sub: "user-2", tenant_id: "tenant-underscore" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.tenantId).toBe("tenant-underscore");
    });

    it("extracts tenantId from apiKey.tenantId when available", () => {
      const req = {
        header: jest.fn(() => undefined),
        apiKey: { id: "key-id-99", tenantId: "tenant-key-scoped" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.tenantId).toBe("tenant-key-scoped");
      expect(result.context?.actor).toBe("key-id-99");
    });

    it("extracts tenantId from apiKey.id fallback", () => {
      const req = {
        header: jest.fn(() => undefined),
        apiKey: { id: "key-fallback-id" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.tenantId).toBe("key-fallback-id");
    });

    it("resolves service bypass via x-admin-bypass with apiKey credentials", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "x-admin-bypass") return "true";
          if (name === "x-bypass-reason") return "manual_investigation";
          return undefined;
        }),
        apiKey: { id: "ops-key" },
        ip: "10.0.0.1",
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.isServiceBypass).toBe(true);
      expect(result.context?.isAdmin).toBe(true);
      expect(result.context?.tenantId).toBe("ops-key");
      expect(result.context?.reason).toBe("manual_investigation");
    });

    it("resolves role bypass via x-service-role admin with admin key header", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "x-service-role") return "admin";
          if (name === "x-admin-key") return "valid-secret";
          return undefined;
        }),
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.isServiceBypass).toBe(true);
      expect(result.context?.tenantId).toBe("system-admin");
      expect(result.context?.reason).toBe("administrative_override");
    });

    it("resolves role bypass via user.role admin", () => {
      const req = {
        header: jest.fn(() => undefined),
        user: { sub: "admin-user", role: "admin" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.isAdmin).toBe(true);
      expect(result.context?.isServiceBypass).toBe(true);
    });

    it("resolves role bypass via apiKey.role admin", () => {
      const req = {
        header: jest.fn(() => undefined),
        apiKey: { id: "admin-key", role: "admin" },
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.isAdmin).toBe(true);
      expect(result.context?.isServiceBypass).toBe(true);
    });

    it("resolves bearer authentication fallback to system-admin", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "authorization") return "Bearer secret-token-123";
          return undefined;
        }),
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.error).toBeUndefined();
      expect(result.context?.tenantId).toBe("system-admin");
      expect(result.context?.isServiceBypass).toBe(true);
      expect(result.context?.reason).toBe("bearer_system_context");
    });
  });

  describe("canAccessStream", () => {
    const defaultContext: TenantContext = {
      tenantId: "tenant-one",
      actor: "user-1",
      isServiceBypass: false,
      isAdmin: false,
      ipAddress: "127.0.0.1",
    };

    it("permits access when context has isServiceBypass true", () => {
      const bypassContext: TenantContext = {
        ...defaultContext,
        isServiceBypass: true,
      };
      expect(service.canAccessStream(bypassContext, { tenantId: "other-tenant" })).toBe(true);
    });

    it("permits access when context has isAdmin true", () => {
      const adminContext: TenantContext = {
        ...defaultContext,
        isAdmin: true,
      };
      expect(service.canAccessStream(adminContext, { tenantId: "other-tenant" })).toBe(true);
    });

    it("permits access when stream has null or undefined tenantId", () => {
      expect(service.canAccessStream(defaultContext, { tenantId: null })).toBe(true);
      expect(service.canAccessStream(defaultContext, { tenantId: undefined })).toBe(true);
    });

    it("permits access when tenantId matches", () => {
      expect(service.canAccessStream(defaultContext, { tenantId: "tenant-one" })).toBe(true);
    });

    it("denies access when tenantId does not match", () => {
      expect(service.canAccessStream(defaultContext, { tenantId: "tenant-two" })).toBe(false);
    });
  });

  describe("auditBypass", () => {
    it("logs sensitive action when bypass is active", async () => {
      const bypassContext: TenantContext = {
        tenantId: "system-admin",
        actor: "admin-principal",
        isServiceBypass: true,
        isAdmin: true,
        ipAddress: "10.10.10.10",
        reason: "forensic_analysis",
      };

      await service.auditBypass(bypassContext, {
        streamId: "stream-xyz",
        action: "read_stream",
        route: "/api/v1/streams/stream-xyz",
        method: "GET",
        details: { flag: true },
      });

      expect(mockAuditService.logSensitiveAction).toHaveBeenCalledWith({
        actor: "admin-principal",
        action: "stream_admin_action",
        streamId: "stream-xyz",
        ipAddress: "10.10.10.10",
        metadata: {
          bypass: true,
          reason: "forensic_analysis",
          operation: "read_stream",
          route: "/api/v1/streams/stream-xyz",
          method: "GET",
          flag: true,
        },
      });
    });

    it("does nothing when context is not bypass or admin", async () => {
      const regularContext: TenantContext = {
        tenantId: "tenant-regular",
        actor: "user-regular",
        isServiceBypass: false,
        isAdmin: false,
        ipAddress: "127.0.0.1",
      };

      await service.auditBypass(regularContext, {
        streamId: "stream-xyz",
        action: "read_stream",
      });

      expect(mockAuditService.logSensitiveAction).not.toHaveBeenCalled();
    });

    it("handles audit logging errors gracefully", async () => {
      mockAuditService.logSensitiveAction.mockRejectedValueOnce(new Error("Audit DB unreachable"));
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const adminContext: TenantContext = {
        tenantId: "system-admin",
        actor: "admin-principal",
        isServiceBypass: true,
        isAdmin: true,
        ipAddress: "127.0.0.1",
      };

      await expect(
        service.auditBypass(adminContext, { action: "test_action" }),
      ).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("uses default audit service instance when constructed without args", () => {
      const defaultService = new TenantAuthorizationService();
      expect(defaultService).toBeDefined();
    });
  });

  describe("actor fallback resolution", () => {
    it("resolves actor from x-actor-id header when user and apiKey lack id", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "x-tenant-id") return "tenant-1";
          if (name === "x-actor-id") return "custom-actor";
          return undefined;
        }),
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.actor).toBe("custom-actor");
    });

    it("falls back to system when no actor identity is available", () => {
      const req = {
        header: jest.fn((name: string) => {
          if (name === "x-tenant-id") return "tenant-1";
          return undefined;
        }),
      } as unknown as Request;

      const result = service.extractTenantContext(req);
      expect(result.context?.actor).toBe("system");
    });
  });
});
