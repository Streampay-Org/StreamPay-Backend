import { ERROR_CODES, HTTP_STATUS } from "./http";

describe("HTTP_STATUS", () => {
  it("contains the common success codes", () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.CREATED).toBe(201);
    expect(HTTP_STATUS.ACCEPTED).toBe(202);
    expect(HTTP_STATUS.NO_CONTENT).toBe(204);
  });

  it("contains the common client error codes", () => {
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429);
  });

  it("contains the common server error codes", () => {
    expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
    expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
    expect(HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe("ERROR_CODES", () => {
  it("uses snake_case stable identifiers", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    }
  });

  it("has unique values", () => {
    const values = Object.values(ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});
