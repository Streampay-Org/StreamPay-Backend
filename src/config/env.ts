import { z } from "zod";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  RPC_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Rate limiting (all optional — sensible defaults are applied in the middleware)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().positive().default(100),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().positive().default(900_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().positive().default(20),
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
