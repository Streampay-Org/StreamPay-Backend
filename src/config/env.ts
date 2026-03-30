import { z } from "zod";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  RPC_URL: z.string().url(),
  TX_SIGNER_MODE: z.enum(["backend_sign", "external_signer"]).default("external_signer"),
  TX_SIGNING_SEED: z.string().optional(),
  TX_SIGNING_KMS_KEY_ID: z.string().optional(),
  TX_EXTERNAL_SIGNER_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
}).superRefine((value, ctx) => {
  if (value.TX_SIGNING_SEED && value.NODE_ENV !== "development") {
    ctx.addIssue({
      code: "custom",
      path: ["TX_SIGNING_SEED"],
      message: "TX_SIGNING_SEED is only allowed in development.",
    });
  }

  if (
    value.TX_SIGNER_MODE === "backend_sign"
    && value.NODE_ENV !== "development"
    && !value.TX_SIGNING_KMS_KEY_ID
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["TX_SIGNING_KMS_KEY_ID"],
      message: "TX_SIGNING_KMS_KEY_ID is required outside development when TX_SIGNER_MODE=backend_sign.",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (config: NodeJS.ProcessEnv): Env => {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    if (process.env.NODE_ENV !== "test") {
      console.error("❌ Invalid environment variables:");
      console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
      process.exit(1);
    }
    throw new Error("Invalid environment variables: " + JSON.stringify(result.error.flatten().fieldErrors));
  }

  return result.data;
};

// Fail fast at startup, but skip during tests to allow manual validation testing
export const env = process.env.NODE_ENV === "test" 
  ? ({} as unknown as Env) 
  : validateEnv(process.env);
