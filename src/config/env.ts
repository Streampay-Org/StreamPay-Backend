import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  RPC_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_POOL_MAX: z.coerce.number().min(1).max(100).default(10),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().min(0).default(30000),
  DB_CONNECTION_TIMEOUT: z.coerce.number().min(0).default(5000),
  DB_STATEMENT_TIMEOUT: z.coerce.number().min(0).default(30000),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (config: NodeJS.ProcessEnv): Env => {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Invalid environment variables:");
      console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
      process.exit(1);
    }
    throw new Error("Invalid environment variables: " + JSON.stringify(result.error.flatten().fieldErrors));
  }

  return result.data;
};

export const env = process.env.NODE_ENV === "test"
  ? ({
      PORT: 3001,
      DATABASE_URL: "postgres://user:password@localhost:5432/streampay",
      JWT_SECRET: "test_secret_key_at_least_32_characters_long",
      RPC_URL: "https://api.testnet.solana.com",
      NODE_ENV: "test" as const,
      DB_POOL_MAX: 5,
      DB_POOL_IDLE_TIMEOUT: 10000,
      DB_CONNECTION_TIMEOUT: 2000,
      DB_STATEMENT_TIMEOUT: 10000,
    })
  : validateEnv(process.env);
