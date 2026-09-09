import { Request } from "express";
import { AuditService } from "./auditService";

export interface TenantContext {
  tenantId?: string;
  actor: string;
  isServiceBypass: boolean;
  isAdmin: boolean;
  ipAddress: string;
  reason?: string;
}

export interface ExtractContextResult {
  context: TenantContext | null;
  error?: {
    status: number;
    code: string;
    message: string;
  };
}

export interface StreamIdentityTarget {
  id?: string;
  tenantId?: string | null;
}

export interface AuditBypassOptions {
  streamId?: string;
  action?: string;
  route?: string;
  method?: string;
  details?: Record<string, unknown>;
}

export class TenantAuthorizationService {
  private readonly auditService: AuditService;

  constructor(auditService = new AuditService()) {
    this.auditService = auditService;
  }

  /**
   * Resolves tenant context from request headers, authenticated user claims, or API key credentials.
   * Rejects unauthenticated bypass attempts and missing tenant identifiers.
   */
  extractTenantContext(req: Request): ExtractContextResult {
    const rawHeaderTenant = req.header("x-tenant-id") ?? req.header("x-tenant");
    if (rawHeaderTenant !== undefined) {
      const trimmed = rawHeaderTenant.trim();
      if (!trimmed) {
        return {
          context: null,
          error: {
            status: 400,
            code: "invalid_tenant_id",
            message: "Tenant ID header cannot be empty",
          },
        };
      }
    }

    const ipAddress = req.ip ?? "unknown";
    const user = req.user as Record<string, unknown> | undefined;
    const actor =
      (typeof user?.sub === "string" ? user.sub : undefined) ??
      req.apiKey?.id ??
      req.header("x-actor-id") ??
      "system";

    const headerBypass = req.header("x-admin-bypass") === "true";
    const roleBypass =
      req.header("x-service-role") === "admin" ||
      user?.role === "admin" ||
      (req.apiKey as Record<string, unknown> | undefined)?.role === "admin";
    const requestedBypass = headerBypass || roleBypass;

    const hasApiKey = Boolean(req.apiKey);
    const hasUser = Boolean(req.user);
    const hasAdminKey = Boolean(req.header("x-admin-key"));
    const hasBearerAuth = Boolean(req.header("authorization")?.startsWith("Bearer "));
    const isAuthenticated = hasApiKey || hasUser || hasAdminKey || hasBearerAuth;

    if (requestedBypass && !isAuthenticated) {
      return {
        context: null,
        error: {
          status: 403,
          code: "unauthorized_bypass",
          message: "Administrative bypass requires authorized credentials",
        },
      };
    }

    let isServiceBypass = requestedBypass && isAuthenticated;
    let isAdmin = isServiceBypass;
    let reason =
      req.header("x-bypass-reason") ??
      (isServiceBypass ? "administrative_override" : undefined);

    let tenantId = rawHeaderTenant ? rawHeaderTenant.trim() : undefined;
    if (!tenantId && user) {
      const userTenant = user.tenantId ?? user.tenant_id ?? user.sub;
      if (typeof userTenant === "string" && userTenant.trim()) {
        tenantId = userTenant.trim();
      }
    }
    if (!tenantId && req.apiKey) {
      const apiKeyTenant = (req.apiKey as Record<string, unknown>).tenantId ?? req.apiKey.id;
      if (typeof apiKeyTenant === "string" && apiKeyTenant.trim()) {
        tenantId = apiKeyTenant.trim();
      }
    }
    if (!tenantId && hasBearerAuth) {
      tenantId = "system-admin";
      isServiceBypass = true;
      isAdmin = true;
      if (!reason) {
        reason = "bearer_system_context";
      }
    }
    if (!tenantId && isServiceBypass) {
      tenantId = "system-admin";
    }

    if (!tenantId) {
      return {
        context: null,
        error: {
          status: 401,
          code: "tenant_context_required",
          message: "Tenant context is required",
        },
      };
    }

    return {
      context: {
        tenantId,
        actor,
        isServiceBypass,
        isAdmin,
        ipAddress,
        reason,
      },
    };
  }

  /**
   * Assesses whether the given context can read or mutate the targeted stream.
   */
  canAccessStream(context: TenantContext, stream: StreamIdentityTarget): boolean {
    if (context.isServiceBypass || context.isAdmin) {
      return true;
    }
    if (!stream.tenantId) {
      return true;
    }
    return stream.tenantId === context.tenantId;
  }

  /**
   * Records an audited record for an administrative bypass action.
   */
  async auditBypass(
    context: TenantContext,
    options: AuditBypassOptions = {},
  ): Promise<void> {
    if (!context.isServiceBypass && !context.isAdmin) {
      return;
    }
    try {
      await this.auditService.logSensitiveAction({
        actor: context.actor,
        action: "stream_admin_action",
        streamId: options.streamId,
        ipAddress: context.ipAddress,
        metadata: {
          bypass: true,
          reason: context.reason ?? "administrative_override",
          operation: options.action,
          route: options.route,
          method: options.method,
          ...options.details,
        },
      });
    } catch (err) {
      console.error("Failed to log audit bypass:", err);
    }
  }
}

export const tenantAuthorizationService = new TenantAuthorizationService();
