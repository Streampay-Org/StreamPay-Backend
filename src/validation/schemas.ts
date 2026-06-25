import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitive validators
// ---------------------------------------------------------------------------

/**
 * Stellar ed25519 public key (G... account address).
 *
 * - Exactly 56 characters long
 * - Starts with 'G'
 * - Valid base32 character set (A–Z, 2–7)
 */
export const stellarAddressSchema = z
  .string()
  .length(56, "Stellar address must be exactly 56 characters")
  .regex(
    /^G[A-Z2-7]{55}$/,
    "Stellar address must start with 'G' and contain only valid base32 characters",
  );

/**
 * Positive decimal string matching a `decimal(20,9)` database column.
 *
 * - Must be parseable as a positive number
 * - At most 9 digits after the decimal point
 */
export const decimalAmountSchema = z
  .string()
  .regex(
    /^\d+(\.\d{1,9})?$/,
    "Must be a positive decimal string with at most 9 fractional digits",
  )
  .refine((val) => parseFloat(val) > 0, "Must be greater than 0");

/**
 * Reusable canonical UUID schema.
 */
export const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Request-level schemas
// ---------------------------------------------------------------------------

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
  id: uuidSchema,
});
