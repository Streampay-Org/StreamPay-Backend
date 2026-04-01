import { CorsOptions } from "cors";

type CorsRuntimeConfig = {
  NODE_ENV?: string;
  CORS_ALLOWED_ORIGINS?: string;
};

const parseAllowedOrigins = (rawOrigins?: string): string[] => {
  if (!rawOrigins) {
    return [];
  }

  return rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

export const createCorsOptions = (config: CorsRuntimeConfig = process.env): CorsOptions => {
  const nodeEnv = config.NODE_ENV ?? "development";
  const allowedOrigins = parseAllowedOrigins(config.CORS_ALLOWED_ORIGINS);

  if (nodeEnv === "production") {
    if (allowedOrigins.length === 0) {
      throw new Error("CORS_ALLOWED_ORIGINS must be configured in production.");
    }

    if (allowedOrigins.includes("*")) {
      throw new Error("CORS wildcard '*' is not allowed in production.");
    }
  }

  const allowedOriginSet = new Set(allowedOrigins);

  return {
    origin(origin, callback) {
      // Non-browser requests do not send an Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      // Local and test environments can stay permissive by default.
      if (allowedOrigins.length === 0) {
        callback(null, true);
        return;
      }

      if (allowedOriginSet.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    optionsSuccessStatus: 204,
  };
};
