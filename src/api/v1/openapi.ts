import { OpenApiGeneratorV3, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  AccrualPreviewSchema,
  CreateStreamSchema,
  CreateWebhookSchema,
  CreatedWebhookSchema,
  CsvExportSchema,
  ErrorSchema,
  ExportQuerySchema,
  HealthSchema,
  IndexerAcceptedSchema,
  IndexerWebhookSchema,
  PaginationQuerySchema,
  StreamListSchema,
  StreamSchema,
  UpdateStreamSchema,
  UuidParamsSchema,
  ValidationErrorSchema,
  WebhookSchema,
} from "./schemas";

export const registry = new OpenAPIRegistry();

const protectedSecurity: Array<Record<string, string[]>> = [
  { apiKeyHeader: [] },
  { apiKeyAuthorization: [] },
];

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const errors = (includeValidation = false) => ({
  ...(includeValidation ? { 400: json(ValidationErrorSchema, "Request validation failed.") } : { 400: json(ErrorSchema, "Bad request.") }),
  401: json(ErrorSchema, "API key missing, invalid, or revoked."),
  404: json(ErrorSchema, "Resource not found."),
  500: json(ErrorSchema, "Internal server error."),
});

registry.registerComponent("securitySchemes", "apiKeyHeader", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "Service API key.",
});
registry.registerComponent("securitySchemes", "apiKeyAuthorization", {
  type: "apiKey",
  in: "header",
  name: "Authorization",
  description: "Use the `ApiKey <key>` authorization scheme.",
});
registry.registerComponent("securitySchemes", "jwtBearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT required by the CSV export handler in addition to the API key.",
});
registry.register("Stream", StreamSchema);
registry.register("StreamList", StreamListSchema);
registry.register("Error", ErrorSchema);
registry.register("ValidationError", ValidationErrorSchema);
registry.register("Health", HealthSchema);
registry.register("AccrualPreview", AccrualPreviewSchema);
registry.register("Webhook", WebhookSchema);
registry.register("CreatedWebhook", CreatedWebhookSchema);
registry.register("IndexerAccepted", IndexerAcceptedSchema);

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  tags: ["Health"],
  summary: "Get service health",
  description: "Returns liveness status; use `deep=1` to probe the database and configured RPC.",
  request: { query: z.object({ deep: z.enum(["1", "true"]).optional() }) },
  responses: {
    200: json(HealthSchema, "Service is healthy."),
    503: json(HealthSchema, "A deep dependency check failed."),
  },
});

registry.registerPath({
  method: "get",
  path: "/health/ready",
  operationId: "getReadiness",
  tags: ["Health"],
  summary: "Get dependency readiness",
  responses: {
    200: json(HealthSchema, "All configured dependencies are healthy."),
    503: json(HealthSchema, "A configured dependency is unhealthy."),
  },
});

registry.registerPath({
  method: "get",
  path: "/metrics",
  operationId: "getMetrics",
  tags: ["Operations"],
  summary: "Expose Prometheus metrics",
  description: "Returns Prometheus text exposition; production deployments require a bearer token.",
  responses: { 200: { description: "Prometheus metrics.", content: { "text/plain": { schema: CsvExportSchema } } }, 401: { description: "Bearer token missing or invalid." } },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/streams",
  operationId: "listStreams",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "List payment streams",
  request: { query: PaginationQuerySchema },
  responses: { 200: json(StreamListSchema, "A paginated stream list."), ...errors() },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/streams",
  operationId: "createStream",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "Create a payment stream",
  request: { body: { required: true, content: { "application/json": { schema: CreateStreamSchema } } } },
  responses: { 201: json(StreamSchema, "The newly created stream."), ...errors(true) },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/streams/export.csv",
  operationId: "exportStreamsCsv",
  tags: ["Streams"],
  security: [{ apiKeyHeader: [], jwtBearer: [] }, { apiKeyAuthorization: [], jwtBearer: [] }],
  summary: "Export streams as CSV",
  request: { query: ExportQuerySchema },
  responses: {
    200: { description: "RFC 4180 stream export.", content: { "text/csv": { schema: CsvExportSchema } } },
    401: json(ErrorSchema, "API key or JWT is missing/invalid."),
    500: json(ErrorSchema, "Export failed."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/streams/{id}",
  operationId: "getStream",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "Get a payment stream",
  request: { params: UuidParamsSchema, query: z.object({ includeDeleted: z.enum(["true", "false"]).optional() }) },
  responses: { 200: json(StreamSchema, "The requested stream."), ...errors() },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/streams/{id}",
  operationId: "updateStream",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "Update a payment stream",
  description: "Supports labels, memo, status, and optional optimistic-lock timestamp.",
  request: { params: UuidParamsSchema, body: { required: true, content: { "application/json": { schema: UpdateStreamSchema } } } },
  responses: { 200: json(StreamSchema, "The updated stream."), ...errors() },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/streams/{id}",
  operationId: "deleteStream",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "Soft-delete a payment stream",
  request: { params: UuidParamsSchema },
  responses: { 204: { description: "Stream soft-deleted." }, ...errors() },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/streams/{id}/accrual-preview",
  operationId: "previewStreamAccrual",
  tags: ["Streams"],
  security: protectedSecurity,
  summary: "Preview accrued stream amount",
  responses: { 200: json(AccrualPreviewSchema, "Estimated accrued amount."), ...errors() },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/webhooks",
  operationId: "createWebhookSubscription",
  tags: ["Webhooks"],
  security: protectedSecurity,
  summary: "Register an outbound webhook",
  request: { body: { required: true, content: { "application/json": { schema: CreateWebhookSchema } } } },
  responses: { 201: json(CreatedWebhookSchema, "Subscription and one-time signing secret."), ...errors(true) },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/webhooks",
  operationId: "listWebhookSubscriptions",
  tags: ["Webhooks"],
  security: protectedSecurity,
  summary: "List outbound webhooks",
  responses: { 200: { description: "Subscriptions without signing secrets.", content: { "application/json": { schema: z.array(WebhookSchema) } } }, ...errors() },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/webhooks/{id}",
  operationId: "deleteWebhookSubscription",
  tags: ["Webhooks"],
  security: protectedSecurity,
  summary: "Delete an outbound webhook",
  request: { params: UuidParamsSchema },
  responses: { 204: { description: "Subscription deleted." }, ...errors() },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/indexer",
  operationId: "ingestIndexerWebhook",
  tags: ["Webhooks"],
  security: protectedSecurity,
  summary: "Ingest a signed indexer event",
  description: "The signature is calculated over the exact raw JSON bytes and sent as `x-indexer-signature`.",
  request: {
    headers: z.object({ "x-indexer-signature": z.string().min(1) }),
    body: { required: true, content: { "application/json": { schema: IndexerWebhookSchema } } },
  },
  responses: {
    200: json(IndexerAcceptedSchema, "New event accepted."),
    202: json(IndexerAcceptedSchema, "Duplicate event acknowledged without reprocessing."),
    400: json(ErrorSchema, "Invalid raw body, JSON, or payload."),
    401: json(ErrorSchema, "API key or signature invalid."),
    500: json(ErrorSchema, "Webhook secret is unavailable."),
    503: json(ErrorSchema, "Replay-protection storage is unavailable."),
  },
});

export function generateOpenApi() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "StreamPay API",
      description: "API for managing payment streams, metering, settlement, and signed webhooks.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Health", description: "Service liveness and readiness." },
      { name: "Streams", description: "Stream lifecycle and reporting." },
      { name: "Webhooks", description: "Outbound subscriptions and signed indexer ingestion." },
      { name: "Operations", description: "Metrics and operational endpoints." },
    ],
  });
}
