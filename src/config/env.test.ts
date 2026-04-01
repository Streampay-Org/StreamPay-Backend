import { envSchema, validateEnv } from "./env";

describe("Environment Configuration Schema", () => {
  beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  const validEnv = {
    PORT: "3001",
    DATABASE_URL: "postgres://localhost:5432/db",
    JWT_SECRET: "a_very_long_secret_that_is_at_least_32_characters",
    RPC_URL: "https://api.mainnet-beta.solana.com",
    NODE_ENV: "development",
    DB_POOL_MAX: "15",
    DB_POOL_IDLE_TIMEOUT: "45000",
    DB_CONNECTION_TIMEOUT: "8000",
    DB_STATEMENT_TIMEOUT: "45000",
  };

  it("should validate a correct configuration", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3001);
      expect(result.data.NODE_ENV).toBe("development");
    }
  });

  it("should fail if DATABASE_URL is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL, ...invalidEnv } = validEnv;
    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty("DATABASE_URL");
    }
  });

  it("should fail if JWT_SECRET is too short", () => {
    const invalidEnv = { ...validEnv, JWT_SECRET: "short" };
    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.JWT_SECRET).toContain("JWT_SECRET must be at least 32 characters");
    }
  });

  it("should fail if RPC_URL is not a valid URL", () => {
    const invalidEnv = { ...validEnv, RPC_URL: "not-a-url" };
    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty("RPC_URL");
    }
  });

  it("should default PORT to 3001 if missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PORT, ...envWithoutPort } = validEnv;
    const result = envSchema.safeParse(envWithoutPort);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3001);
    }
  });

  it("should default NODE_ENV to development if missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { NODE_ENV, ...envWithoutNodeEnv } = validEnv;
    const result = envSchema.safeParse(envWithoutNodeEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe("development");
    }
  });

  describe("validateEnv function", () => {
    it("should throw in test environment if validation fails", () => {
      expect(() => validateEnv({})).toThrow("Invalid environment variables");
    });

    it("should return validated data if validation succeeds", () => {
      const data = validateEnv(validEnv);
      expect(data.PORT).toBe(3001);
    });
  });

  describe("Database pool configuration", () => {
    it("should validate pool configuration with default values", () => {
      const envWithoutPool = {
        PORT: "3001",
        DATABASE_URL: "postgres://localhost:5432/db",
        JWT_SECRET: "a_very_long_secret_that_is_at_least_32_characters",
        RPC_URL: "https://api.mainnet-beta.solana.com",
        NODE_ENV: "development",
      };
      const result = envSchema.safeParse(envWithoutPool);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_POOL_MAX).toBe(10);
        expect(result.data.DB_POOL_IDLE_TIMEOUT).toBe(30000);
        expect(result.data.DB_CONNECTION_TIMEOUT).toBe(5000);
        expect(result.data.DB_STATEMENT_TIMEOUT).toBe(30000);
      }
    });

    it("should parse custom pool configuration", () => {
      const result = envSchema.safeParse(validEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_POOL_MAX).toBe(15);
        expect(result.data.DB_POOL_IDLE_TIMEOUT).toBe(45000);
        expect(result.data.DB_CONNECTION_TIMEOUT).toBe(8000);
        expect(result.data.DB_STATEMENT_TIMEOUT).toBe(45000);
      }
    });

    it("should reject DB_POOL_MAX below 1", () => {
      const invalidEnv = { ...validEnv, DB_POOL_MAX: "0" };
      const result = envSchema.safeParse(invalidEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.DB_POOL_MAX).toBeDefined();
      }
    });

    it("should reject DB_POOL_MAX above 100", () => {
      const invalidEnv = { ...validEnv, DB_POOL_MAX: "150" };
      const result = envSchema.safeParse(invalidEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.DB_POOL_MAX).toBeDefined();
      }
    });
  });
});
