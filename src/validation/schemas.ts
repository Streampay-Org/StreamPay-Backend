import { z } from "zod";

/**
 * Streams query validation
 */
export const getStreamsQuerySchema = z.object({
  payer: z.string().optional(),
  recipient: z.string().optional(),
  status: z.enum(["active", "paused", "cancelled", "completed"]).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

/**
 * UUID param validation
 */
export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});
