/**
 * HTTP-related constants used across handlers and middleware.
 *
 * Using named constants makes intent obvious at the call site and avoids
 * scattering magic numbers through the codebase.
 */

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/** Common error codes used in JSON error responses. */
export const ERROR_CODES = {
  INVALID_JSON: "invalid_json",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  HEADERS_TOO_LARGE: "headers_too_large",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  RATE_LIMITED: "rate_limited",
  VALIDATION_FAILED: "validation_failed",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
