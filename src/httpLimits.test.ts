import http from "http";
import { AddressInfo } from "net";

import { NextFunction, Request, Response } from "express";
import request from "supertest";

import app, {
  createHttpServer,
  httpBodyErrorHandler,
  JSON_BODY_LIMIT,
  JSON_BODY_LIMIT_BYTES,
  MAX_HEADER_SIZE_BYTES,
  rejectOversizedJsonPayload,
} from "./index";

function sendOversizedHeaderRequest(port: number): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        method: "GET",
        headers: {
          "x-oversized-header": "a".repeat(MAX_HEADER_SIZE_BYTES),
        },
      },
      (res) => {
        let body = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

function sendChunkedJsonRequest(port: number, body: string): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/streams",
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      },
      (res) => {
        let responseBody = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: responseBody });
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("HTTP size limits", () => {
  let server: http.Server;

  afterEach((done) => {
    if (!server || !server.listening) {
      done();
      return;
    }

    server.close(done);
  });

  it("returns 413 for oversized JSON bodies with a consistent error shape", async () => {
    const oversizedPayload = JSON.stringify({ data: "x".repeat(JSON_BODY_LIMIT_BYTES) });

    const res = await request(app)
      .post("/api/v1/streams")
      .set("Content-Type", "application/json")
      .send(oversizedPayload);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: "payload_too_large",
      message: `JSON request body exceeds ${JSON_BODY_LIMIT} limit.`,
    });
  });

  it("allows declared JSON payloads at or below the configured body limit", () => {
    const next = jest.fn() as unknown as NextFunction;
    const req = {
      is: jest.fn().mockReturnValue(true),
      header: jest.fn().mockReturnValue(String(JSON_BODY_LIMIT_BYTES)),
    } as unknown as Request;
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    } as unknown as Response;

    rejectOversizedJsonPayload(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows chunked JSON requests without a content-length header to continue", async () => {
    server = createHttpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const { port } = server.address() as AddressInfo;
    const response = await sendChunkedJsonRequest(port, JSON.stringify({ ok: true }));

    expect(response.statusCode).toBe(404);
  });

  it("ignores invalid content-length headers and defers to downstream parsing", () => {
    const next = jest.fn() as unknown as NextFunction;
    const req = {
      is: jest.fn().mockReturnValue(true),
      header: jest.fn().mockReturnValue("not-a-number"),
    } as unknown as Request;
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    } as unknown as Response;

    rejectOversizedJsonPayload(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns structured 413 responses for parser-enforced size violations", () => {
    const next = jest.fn() as unknown as NextFunction;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    httpBodyErrorHandler(
      { status: 413, type: "entity.too.large" },
      {} as Request,
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: "payload_too_large",
      message: `JSON request body exceeds ${JSON_BODY_LIMIT} limit.`,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns structured 400 responses for invalid JSON parser errors", () => {
    const next = jest.fn() as unknown as NextFunction;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    httpBodyErrorHandler(
      { status: 400, type: "entity.parse.failed" },
      {} as Request,
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes unrelated errors through the parser error handler", () => {
    const next = jest.fn() as unknown as NextFunction;
    const error = new Error("boom");

    httpBodyErrorHandler(error, {} as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("enforces the configured max header size at the server level", async () => {
    server = createHttpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const { port } = server.address() as AddressInfo;
    const response = await sendOversizedHeaderRequest(port);

    expect(response.statusCode).toBe(431);
    expect(JSON.parse(response.body)).toEqual({
      error: "headers_too_large",
      message: `Request headers exceed ${MAX_HEADER_SIZE_BYTES} byte limit.`,
    });
  });

  it("destroys sockets for non-header-overflow client errors", () => {
    server = createHttpServer();
    const socket = {
      destroy: jest.fn(),
      end: jest.fn(),
      writable: true,
    };

    server.emit("clientError", Object.assign(new Error("socket failure"), { code: "ECONNRESET" }), socket);

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(socket.end).not.toHaveBeenCalled();
  });

  it("destroys non-writable sockets during header overflow handling", () => {
    server = createHttpServer();
    const socket = {
      destroy: jest.fn(),
      end: jest.fn(),
      writable: false,
    };

    server.emit(
      "clientError",
      Object.assign(new Error("header overflow"), { code: "HPE_HEADER_OVERFLOW" }),
      socket,
    );

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(socket.end).not.toHaveBeenCalled();
  });
});
