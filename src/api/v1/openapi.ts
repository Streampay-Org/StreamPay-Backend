import { OpenApiGeneratorV3, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  StreamSchema,
  StreamListSchema,
  ErrorSchema,
  HealthSchema,
  StreamStatusSchema,
} from "./schemas";

export const registry = new OpenAPIRegistry();

// Register Schemas
registry.register("Stream", StreamSchema);
registry.register("StreamList", StreamListSchema);
registry.register("Error", ErrorSchema);
registry.register("Health", HealthSchema);

// GET /health
registry.registerPath({
  method: "get",
  path: "/health",
  description: "Get service health status",
  summary: "Health Check",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: HealthSchema,
        },
      },
    },
  },
});

// GET /api/v1/streams
registry.registerPath({
  method: "get",
  path: "/api/v1/streams",
  description: "Get a list of payment streams",
  summary: "List Streams",
  request: {
    query: z.object({
      payer: z.string().optional().openapi({ description: "Filter by payer address" }),
      recipient: z.string().optional().openapi({ description: "Filter by recipient address" }),
      status: StreamStatusSchema.optional(),
      limit: z.string().optional().openapi({ description: "Number of records to return", example: "20" }),
      offset: z.string().optional().openapi({ description: "Number of records to skip", example: "0" }),
    }),
  },
  responses: {
    200: {
      description: "List of streams",
      content: {
        "application/json": {
          schema: StreamListSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

// GET /api/v1/streams/{id}
registry.registerPath({
  method: "get",
  path: "/api/v1/streams/{id}",
  description: "Get details of a specific payment stream",
  summary: "Get Stream",
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "The unique identifier of the stream" }),
    }),
  },
  responses: {
    200: {
      description: "Stream details",
      content: {
        "application/json": {
          schema: StreamSchema,
        },
      },
    },
    400: {
      description: "Invalid stream ID format",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Stream not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

export function generateOpenApi() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "StreamPay API",
      description: "API for managing payment streams, metering, and settlement.",
    },
    servers: [{ url: "/" }],
  });
}
