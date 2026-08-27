import request from "supertest";
import app from "../../index";
import { generateOpenApi } from "./openapi";
import {
  CreateStreamSchema,
  PaginationQuerySchema,
  UpdateStreamSchema,
} from "./schemas";

type LooseOperation = {
  [key: string]: unknown;
  security?: unknown;
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
};

type LooseSpec = {
  paths: Record<string, Record<string, LooseOperation>>;
  components?: {
    schemas?: Record<string, { required?: string[] }>;
    securitySchemes?: unknown;
  };
};

describe("OpenAPI Specification", () => {
  it("should serve the OpenAPI JSON at /api/openapi.json", async () => {
    const response = await request(app).get("/api/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.0");
    expect(response.body.info.title).toBe("StreamPay API");
  });

  it("should include health and stream paths", () => {
    const spec = generateOpenApi() as unknown as LooseSpec;
    expect(spec.paths).toHaveProperty("/health");
    expect(spec.paths).toHaveProperty("/api/v1/streams");
    expect(spec.paths).toHaveProperty("/api/v1/streams/{id}");
  });

  it("documents every mounted public and versioned route", () => {
    const spec = generateOpenApi() as unknown as LooseSpec;
    const expectedRoutes = {
      "/health": ["get"],
      "/health/ready": ["get"],
      "/metrics": ["get"],
      "/api/v1/streams": ["get", "post"],
      "/api/v1/streams/export.csv": ["get"],
      "/api/v1/streams/{id}": ["get", "patch", "delete"],
      "/api/v1/streams/{id}/accrual-preview": ["get"],
      "/api/v1/webhooks": ["get", "post"],
      "/api/v1/webhooks/{id}": ["delete"],
      "/webhooks/indexer": ["post"],
    } as const;

    expect(Object.keys(spec.paths).sort()).toEqual(Object.keys(expectedRoutes).sort());
    for (const [path, methods] of Object.entries(expectedRoutes)) {
      expect(Object.keys(spec.paths[path] ?? {}).filter((method) => method !== "parameters").sort())
        .toEqual([...methods].sort());
    }
  });

  it("makes protected operations explicit about API-key authentication", () => {
    const spec = generateOpenApi() as unknown as LooseSpec;
    const protectedOperations = [
      ["/api/v1/streams", "get"],
      ["/api/v1/streams", "post"],
      ["/api/v1/streams/{id}", "patch"],
      ["/api/v1/webhooks", "post"],
      ["/webhooks/indexer", "post"],
    ] as const;

    expect(spec.components?.securitySchemes).toEqual(expect.objectContaining({
      apiKeyHeader: expect.objectContaining({ type: "apiKey", in: "header", name: "x-api-key" }),
      apiKeyAuthorization: expect.objectContaining({ type: "apiKey", in: "header", name: "Authorization" }),
    }));
    for (const [path, method] of protectedOperations) {
      expect(spec.paths[path]![method]!.security).toEqual([
        { apiKeyHeader: [] },
        { apiKeyAuthorization: [] },
      ]);
    }
  });

  it("keeps pagination and create validation aligned with runtime parsing", () => {
    const validQuery = PaginationQuerySchema.safeParse({ status: "active", limit: "20", offset: "0" });
    expect(validQuery.success).toBe(true);
    if (validQuery.success) {
      expect(validQuery.data).toMatchObject({ status: "active", limit: 20, offset: 0 });
    }

    expect(PaginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
    expect(CreateStreamSchema.safeParse({ payer: "only-payer" }).success).toBe(false);
    expect(UpdateStreamSchema.safeParse({ status: "invalid" }).success).toBe(false);
    expect(UpdateStreamSchema.safeParse({ labels: ["priority"], offChainMemo: null }).success).toBe(true);
  });

  it("describes required fields and response contracts for representative operations", () => {
    const spec = generateOpenApi() as unknown as LooseSpec;
    const create = spec.paths["/api/v1/streams"]!.post!;
    const createBody = create.requestBody!.content["application/json"]!.schema;
    const streamSchema = spec.components?.schemas?.Stream;
    expect(streamSchema).toBeDefined();

    expect(createBody).toEqual(expect.objectContaining({ $ref: "#/components/schemas/CreateStream" }));
    expect(spec.components?.schemas?.CreateStream?.required).toEqual(
      expect.arrayContaining(["payer", "recipient", "ratePerSecond", "startTime", "totalAmount"]),
    );
    expect(streamSchema?.required).toEqual(
      expect.arrayContaining(["id", "status", "startTime", "totalAmount", "lastSettledAt"]),
    );
    expect(create.responses[201]).toBeDefined();
    expect(create.responses[400]).toBeDefined();
    expect(spec.paths["/api/v1/streams/{id}"]!.delete!.responses[204]).toBeDefined();
    expect(spec.paths["/api/v1/streams/export.csv"]!.get!.responses[200]).toBeDefined();
    expect(spec.paths["/webhooks/indexer"]!.post!.responses[202]).toBeDefined();
  });

  it("serves the operational metrics route described by the contract", async () => {
    const response = await request(app).get("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    expect(response.text).toContain("http_request_duration_ms");
  });

  it("should match the snapshot", () => {
    const spec = generateOpenApi();
    // We normalize some fields if necessary, but here we just snapshot
    expect(spec).toMatchSnapshot();
  });
});
