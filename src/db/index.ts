import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, PoolConfig } from "pg";
import * as schema from "./schema";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

const basePoolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
};

const developmentPoolConfig: PoolConfig = {
  ...basePoolConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
};

const productionPoolConfig: PoolConfig = {
  ...basePoolConfig,
  max: isProduction ? 20 : 10,
  idleTimeoutMillis: isProduction ? 60000 : 30000,
  connectionTimeoutMillis: isProduction ? 10000 : 5000,
  statement_timeout: isProduction ? 60000 : 30000,
};

const testPoolConfig: PoolConfig = {
  ...basePoolConfig,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000,
};

const poolConfig = isTest
  ? testPoolConfig
  : isProduction
    ? productionPoolConfig
    : developmentPoolConfig;

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client:", err);
  process.exit(-1);
});

pool.on("connect", () => {
  if (!isTest) {
    console.log("New database client connected");
  }
});

export const db = drizzle(pool, { schema });

export { pool };
