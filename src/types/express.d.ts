import { JwtPayload } from "jsonwebtoken";
import { TenantContext } from "../services/tenantAuthorizationService";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      correlationId?: string;
      tenantContext?: TenantContext;
    }
  }
}
