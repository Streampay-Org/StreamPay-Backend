import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticateJWT } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "a-very-long-test-secret-that-meets-32-char-minimum";

/** Build a minimal mock Express req / res / next triple. */
function makeMocks(authHeader?: string): {
  req: Partial<Request>;
  res: { status: jest.Mock; json: jest.Mock };
  next: jest.Mock;
} {
  const req: Partial<Request> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }), json };
  const next = jest.fn();
  return { req, res, next };
}

/** Sign a token with the shared test secret. */
function sign(
  payload: object,
  options?: jwt.SignOptions
): string {
  return jwt.sign(payload, SECRET, { algorithm: "HS256", ...options });
}

// ---------------------------------------------------------------------------
// Mock env so tests don't depend on a real .env
// ---------------------------------------------------------------------------

jest.mock("../config/env", () => ({
  env: {
    JWT_SECRET: "a-very-long-test-secret-that-meets-32-char-minimum",
    JWT_PUBLIC_KEY: undefined,
    JWT_ISSUER: undefined,
    JWT_AUDIENCE: undefined,
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authenticateJWT middleware", () => {
  describe("token extraction", () => {
    it("returns 401 when Authorization header is absent", () => {
      const { req, res, next } = makeMocks();
      authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.status().json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("Missing") })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when Authorization header has no Bearer prefix", () => {
      const { req, res, next } = makeMocks("Basic sometoken");
      authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when Bearer token is empty string", () => {
      const { req, res, next } = makeMocks("Bearer ");
      authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("valid token", () => {
    it("calls next() and sets req.user on a valid token", (done) => {
      const token = sign({ sub: "user-123", role: "admin" });
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      next.mockImplementation(() => {
        expect(req.user).toBeDefined();
        expect(req.user?.sub).toBe("user-123");
        expect(res.status).not.toHaveBeenCalled();
        done();
      });

      authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
    });
  });

  describe("invalid tokens", () => {
    it("returns 401 for a token signed with the wrong secret", (done) => {
      const token = jwt.sign({ sub: "user-123" }, "different-secret-that-is-long-enough-32c");
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      // Give jsonwebtoken time to call the callback
      setTimeout(() => {
        authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
        setTimeout(() => {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
          done();
        }, 50);
      }, 0);
    });

    it("returns 401 for a completely malformed token", (done) => {
      const { req, res, next } = makeMocks("Bearer not.a.jwt");

      setTimeout(() => {
        authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
        setTimeout(() => {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
          done();
        }, 50);
      }, 0);
    });

    it("returns 401 with 'Token has expired' for an expired token", (done) => {
      const token = sign({ sub: "user-123" }, { expiresIn: -1 });
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      setTimeout(() => {
        authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
        setTimeout(() => {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.status().json).toHaveBeenCalledWith(
            expect.objectContaining({ error: "Token has expired" })
          );
          expect(next).not.toHaveBeenCalled();
          done();
        }, 50);
      }, 0);
    });
  });

  describe("issuer / audience validation", () => {
    beforeEach(() => {
      // Override env for these tests
      const envMod = jest.requireMock("../config/env");
      envMod.env.JWT_ISSUER = "https://auth.streampay.io";
      envMod.env.JWT_AUDIENCE = "streampay-api";
    });

    afterEach(() => {
      const envMod = jest.requireMock("../config/env");
      envMod.env.JWT_ISSUER = undefined;
      envMod.env.JWT_AUDIENCE = undefined;
    });

    it("returns 401 when issuer does not match", (done) => {
      const token = sign(
        { sub: "user-123" },
        { issuer: "https://other-auth.io", audience: "streampay-api" }
      );
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      setTimeout(() => {
        authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
        setTimeout(() => {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
          done();
        }, 50);
      }, 0);
    });

    it("returns 401 when audience does not match", (done) => {
      const token = sign(
        { sub: "user-123" },
        { issuer: "https://auth.streampay.io", audience: "wrong-audience" }
      );
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      setTimeout(() => {
        authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
        setTimeout(() => {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
          done();
        }, 50);
      }, 0);
    });

    it("calls next() when issuer and audience both match", (done) => {
      const token = sign(
        { sub: "user-123" },
        { issuer: "https://auth.streampay.io", audience: "streampay-api" }
      );
      const { req, res, next } = makeMocks(`Bearer ${token}`);

      next.mockImplementation(() => {
        expect(req.user).toBeDefined();
        done();
      });

      authenticateJWT(req as Request, res as unknown as Response, next as NextFunction);
    });
  });
});
