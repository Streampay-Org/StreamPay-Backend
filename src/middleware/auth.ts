import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload, VerifyOptions } from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * JWT authentication middleware.
 *
 * Verifies the Bearer JWT in the `Authorization` header and attaches the
 * decoded payload to `req.user`. Returns 401 on any auth failure.
 *
 * Supports:
 *  - Symmetric signing  (HS256) via `JWT_SECRET`
 *  - Asymmetric signing (RS256) via `JWT_PUBLIC_KEY`
 *  - Optional issuer / audience validation via `JWT_ISSUER` / `JWT_AUDIENCE`
 *
 * Note on clock skew: jsonwebtoken accepts a `clockTolerance` option (seconds).
 * Add `JWT_CLOCK_TOLERANCE` to env if leniency is needed across distributed
 * services with minor clock drift.
 */
export function authenticateJWT(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  // Choose the signing secret/key
  const secret: string | Buffer = env.JWT_PUBLIC_KEY
    ? Buffer.from(env.JWT_PUBLIC_KEY, "utf8")
    : env.JWT_SECRET;

  const options: VerifyOptions = {
    algorithms: env.JWT_PUBLIC_KEY ? ["RS256"] : ["HS256"],
    ...(env.JWT_ISSUER && { issuer: env.JWT_ISSUER }),
    ...(env.JWT_AUDIENCE && { audience: env.JWT_AUDIENCE }),
  };

  jwt.verify(token, secret, options, (err, decoded) => {
    if (err) {
      const message =
        err.name === "TokenExpiredError"
          ? "Token has expired"
          : err.name === "JsonWebTokenError"
          ? "Invalid token"
          : "Token verification failed";

      res.status(401).json({ error: message });
      return;
    }

    req.user = decoded as JwtPayload;
    next();
  });
}
