import request from "supertest";
import app from "./index";
import { apiKeyStore, refreshApiKeyStore, hashApiKey, ApiKeyStore } from "./middleware/apiKeyAuth";
import { StreamRepository } from "./repositories/streamRepository";
import crypto from "crypto";

describe("API key authentication", () => {
  beforeEach(() => {
    process.env.API_KEYS = "valid-service-key";
    refreshApiKeyStore();
    jest.spyOn(StreamRepository.prototype, "findAll").mockResolvedValue({ streams: [], total: 0, limit: 20, offset: 0 });
  });

  afterEach(() => {
    apiKeyStore.clear();
    delete process.env.API_KEYS;
    jest.restoreAllMocks();
  });

  it("accepts a valid key from x-api-key header", async () => {
    const res = await request(app).get("/api/v1/streams").set("x-api-key", "valid-service-key");
    expect(res.status).toBe(200);
  });

  it("rejects a missing key with 401", async () => {
    const res = await request(app).get("/api/v1/streams");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
  });

  it("rejects a revoked key", async () => {
    const record = apiKeyStore.findKeyByValue("valid-service-key");
    expect(record).not.toBeNull();
    if (record) {
      apiKeyStore.revokeKey(record.id);
    }

    const res = await request(app).get("/api/v1/streams").set("x-api-key", "valid-service-key");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key invalid or revoked" });
  });

  it("uses timingSafeEqual in validation", async () => {
    const timingSpy = jest.spyOn(crypto, "timingSafeEqual");
    const res = await request(app).get("/api/v1/streams").set("x-api-key", "valid-service-key");

    expect(res.status).toBe(200);
    expect(timingSpy).toHaveBeenCalled();
    timingSpy.mockRestore();
  });

  it("in-memory store can add and resolve hashed keys", () => {
    const store = new ApiKeyStore();
    store.addPlaintextKey("auth-1", "secret-value");

    const isValid = store.findKeyByValue("secret-value");
    expect(isValid).not.toBeNull();
    expect(isValid?.id).toBe("auth-1");
    expect(isValid?.hash).toBe(hashApiKey("secret-value"));
  });
});
