import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const StreamStatusSchema = z.enum(["active", "paused", "cancelled", "completed"]).openapi({
  description: "Status of the payment stream",
  example: "active",
});

export const StreamSchema = z.object({
  id: z.string().uuid().openapi({
    description: "Unique identifier for the stream",
    example: "550e8400-e29b-411d-a716-446655440000",
  }),
  payer: z.string().openapi({
    description: "Address of the payer",
    example: "0x1234567890123456789012345678901234567890",
  }),
  recipient: z.string().openapi({
    description: "Address of the recipient",
    example: "0x0987654321098765432109876543210987654321",
  }),
  status: StreamStatusSchema,
  ratePerSecond: z.string().openapi({
    description: "Payment rate per second",
    example: "0.0001",
  }),
  startTime: z.date().or(z.string()).openapi({
    description: "Start time of the stream",
    example: "2024-03-24T20:00:00Z",
  }),
  endTime: z.date().or(z.string()).nullable().openapi({
    description: "End time of the stream (optional)",
    example: "2024-12-24T20:00:00Z",
  }),
  totalAmount: z.string().openapi({
    description: "Total amount allocated for the stream",
    example: "100.0",
  }),
  lastSettledAt: z.date().or(z.string()).openapi({
    description: "Last time the stream was settled",
    example: "2024-03-24T20:05:00Z",
  }),
  accruedEstimate: z.string().optional().openapi({
    description: "Estimated accrued amount since last settlement",
    example: "0.05",
  }),
  createdAt: z.date().or(z.string()).openapi({
    description: "Creation timestamp",
    example: "2024-03-24T19:00:00Z",
  }),
  updatedAt: z.date().or(z.string()).openapi({
    description: "Last update timestamp",
    example: "2024-03-24T20:00:00Z",
  }),
}).openapi("Stream");

export const StreamListSchema = z.object({
  streams: z.array(StreamSchema),
  total: z.number().openapi({
    description: "Total number of streams matching the criteria",
    example: 100,
  }),
  limit: z.number().openapi({
    description: "Number of streams returned in this batch",
    example: 20,
  }),
  offset: z.number().openapi({
    description: "Offset for pagination",
    example: 0,
  }),
}).openapi("StreamList");

export const ErrorSchema = z.object({
  error: z.string().openapi({
    description: "Error message",
    example: "Invalid stream ID format",
  }),
}).openapi("Error");

export const HealthSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  service: z.string().openapi({ example: "streampay-backend" }),
  timestamp: z.string().openapi({ example: "2024-03-24T20:00:00Z" }),
}).openapi("Health");
