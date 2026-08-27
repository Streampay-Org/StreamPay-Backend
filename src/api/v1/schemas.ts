import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

const isoDate = z.string().datetime({ offset: true });

export const StreamStatusSchema = z.enum(["active", "paused", "cancelled", "completed"]).openapi({
  description: "Lifecycle state of the payment stream.",
  example: "active",
});

export const StreamSchema = z.object({
  id: z.string().uuid().openapi({ description: "Unique stream identifier." }),
  payer: z.string().min(1).openapi({ description: "Address or account that funds the stream." }),
  recipient: z.string().min(1).openapi({ description: "Address or account that receives the stream." }),
  status: StreamStatusSchema,
  ratePerSecond: z.string().regex(/^\d+(\.\d+)?$/).openapi({ example: "0.0001" }),
  startTime: isoDate.openapi({ example: "2026-01-01T00:00:00.000Z" }),
  endTime: isoDate.nullable().openapi({ example: null }),
  totalAmount: z.string().regex(/^\d+(\.\d+)?$/).openapi({ example: "100.0" }),
  lastSettledAt: isoDate.openapi({ example: "2026-01-01T00:00:00.000Z" }),
  labels: z.array(z.string()).optional(),
  offChainMemo: z.string().nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  deletedAt: isoDate.nullable().optional(),
  chainId: z.string().optional(),
  contractAddress: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
  accruedEstimate: z.string().optional().openapi({ description: "Estimated amount accrued since settlement." }),
}).openapi("Stream");

export const CreateStreamSchema = z.object({
  payer: z.string().min(1).openapi({ example: "G...payer" }),
  recipient: z.string().min(1).openapi({ example: "G...recipient" }),
  ratePerSecond: z.string().regex(/^\d+(\.\d+)?$/).openapi({ example: "0.000001" }),
  startTime: isoDate.openapi({ example: "2026-01-01T00:00:00.000Z" }),
  endTime: isoDate.optional(),
  totalAmount: z.string().regex(/^\d+(\.\d+)?$/).openapi({ example: "100.0" }),
}).openapi("CreateStream");

export const UpdateStreamSchema = z.object({
  labels: z.array(z.string()).optional(),
  offChainMemo: z.string().nullable().optional(),
  status: StreamStatusSchema.optional(),
  updatedAt: isoDate.optional().openapi({ description: "Expected current timestamp for optimistic locking." }),
}).strict().openapi("UpdateStream");

export const StreamListSchema = z.object({
  streams: z.array(StreamSchema),
  total: z.number().int().nonnegative().openapi({ example: 100 }),
  limit: z.number().int().min(1).max(100).openapi({ example: 20 }),
  offset: z.number().int().nonnegative().openapi({ example: 0 }),
}).openapi("StreamList");

export const ErrorSchema = z.object({
  error: z.string().openapi({ description: "Stable or human-readable error code." }),
  message: z.string().optional().openapi({ description: "Additional error context." }),
  details: z.record(z.string(), z.array(z.string())).optional(),
}).openapi("Error");

export const ValidationErrorSchema = z.object({
  error: z.literal("Validation failed"),
  details: z.record(z.string(), z.array(z.string())),
}).openapi("ValidationError");

export const HealthSchema = z.object({
  status: z.enum(["ok", "error"]).openapi({ example: "ok" }),
  service: z.string().openapi({ example: "streampay-backend" }),
  timestamp: isoDate.openapi({ example: "2026-01-01T00:00:00.000Z" }),
  details: z.object({
    database: z.enum(["healthy", "unhealthy"]).optional(),
    rpc: z.enum(["healthy", "unhealthy", "disabled"]).optional(),
  }).optional(),
}).openapi("Health");

export const AccrualPreviewSchema = z.object({
  streamId: z.string().uuid(),
  accruedAmount: z.string().openapi({ example: "0.050000000" }),
  calculationTimestamp: isoDate,
  status: StreamStatusSchema,
  disclaimer: z.string(),
  note: z.string(),
}).openapi("AccrualPreview");

export const WebhookEventTypeSchema = z.enum([
  "stream_created", "stream_cancelled", "stream_completed", "stream_paused", "settled",
]);

export const CreateWebhookSchema = z.object({
  url: z.string().url().openapi({ example: "https://example.com/stream-events" }),
  eventTypes: z.array(z.string().min(1)).optional().openapi({
    description: "Event types to receive; omit or use an empty array for all events.",
  }),
}).openapi("CreateWebhook");

export const WebhookSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: isoDate,
}).openapi("Webhook");

export const CreatedWebhookSchema = WebhookSchema.extend({
  secret: z.string().regex(/^[0-9a-f]{64}$/).openapi({ description: "One-time HMAC signing secret." }),
}).openapi("CreatedWebhook");

export const IndexerWebhookSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  streamId: z.string().min(1),
  occurredAt: z.string().min(1),
  chainId: z.string().optional(),
  transactionHash: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).openapi("IndexerWebhook");

export const IndexerAcceptedSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  eventId: z.string(),
  eventType: z.string(),
}).openapi("IndexerAccepted");

export const CsvExportSchema = z.string().openapi({
  type: "string",
  format: "binary",
  description: "RFC 4180 CSV stream of matching payment streams.",
});

export const UuidParamsSchema = z.object({
  id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

export const PaginationQuerySchema = z.object({
  payer: z.string().optional(),
  recipient: z.string().optional(),
  status: StreamStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 20 }),
  offset: z.coerce.number().int().min(0).optional().openapi({ example: 0 }),
});

export const ExportQuerySchema = z.object({
  payer: z.string().optional(),
  recipient: z.string().optional(),
  status: StreamStatusSchema.optional(),
});
