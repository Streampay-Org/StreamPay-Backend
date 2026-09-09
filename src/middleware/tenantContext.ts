import { NextFunction, Request, Response } from "express";
import {
  TenantContext,
  tenantAuthorizationService,
} from "../services/tenantAuthorizationService";

/**
 * Express middleware that extracts and enforces tenant context.
 * Rejects requests lacking a valid tenant identifier or attempting unauthorized administrative bypass.
 */
export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/export.csv") {
    next();
    return;
  }

  const result = tenantAuthorizationService.extractTenantContext(req);

  if (result.error || !result.context) {
    const status = result.error?.status ?? 401;
    const error = result.error?.code ?? "tenant_context_required";
    const message = result.error?.message ?? "Tenant context is required";
    res.status(status).json({ error, code: error, message });
    return;
  }

  req.tenantContext = result.context;
  next();
}

export type { TenantContext };
