import crypto from "crypto";
import request from "supertest";
import app from "./index";
import { apiKeyStore, ApiKeyStore, hashApiKey, refreshApiKeyStore } from "./middleware/apiKeyAuth";
import { StreamRepository } from "./repositories/streamRepository";

describe("API key authentication", () => {
  let findAllSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.API_KEYS = "valid-service-key,secondary-service-key";
    refreshApiKeyStore();
    findAllSpy = jest
      .spyOn(StreamRepository.prototype, "findAll")
      .mockResolvedValue({ streams: [], total: 0, limit: 20, offset: 0 });
  });

  afterEach(() => {
    apiKeyStore.clear();
    delete process.env.API_KEYS;
    delete process.env.API_KEY_HASHES;
    jest.restoreAllMocks();
  });

  it("leaves public operational routes unauthenticated", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);

    const openApi = await request(app).get("/api/openapi.json");
    expect(openApi.status).toBe(200);
  });

  it("accepts a valid key from x-api-key header", async () => {
    const res = await request(app).get("/api/v1/streams").set("x-api-key", "valid-service-key");

    expect(res.status).toBe(200);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid key from Authorization ApiKey header", async () => {
    const res = await request(app).get("/api/v1/streams").set("Authorization", "ApiKey secondary-service-key");

    expect(res.status).toBe(200);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts Authorization ApiKey scheme case-insensitively", async () => {
    const res = await request(app).get("/api/v1/streams").set("Authorization", "apikey secondary-service-key");

    expect(res.status).toBe(200);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts keys seeded from API_KEY_HASHES", async () => {
    process.env.API_KEYS = "";
    process.env.API_KEY_HASHES = hashApiKey("hashed-service-key");
    refreshApiKeyStore();

    const res = await request(app).get("/api/v1/streams").set("x-api-key", "hashed-service-key");

    expect(res.status).toBe(200);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes uppercase hashes seeded from API_KEY_HASHES", async () => {
    process.env.API_KEYS = "";
    process.env.API_KEY_HASHES = hashApiKey("uppercase-hash-key").toUpperCase();
    refreshApiKeyStore();

    const res = await request(app).get("/api/v1/streams").set("x-api-key", "uppercase-hash-key");

    expect(res.status).toBe(200);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed API_KEY_HASHES during store refresh", () => {
    process.env.API_KEYS = "";
    process.env.API_KEY_HASHES = "not-a-sha256-hex-digest";

    expect(() => refreshApiKeyStore()).toThrow("SHA-256 hex hashes");
  });

  it("rejects a missing key with 401 before protected handlers run", async () => {
    const res = await request(app).get("/api/v1/streams");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
    expect(findAllSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported Authorization schemes as a missing API key", async () => {
    const res = await request(app).get("/api/v1/streams").set("Authorization", "Bearer not-an-api-key");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
    expect(findAllSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid key", async () => {
    const res = await request(app).get("/api/v1/streams").set("x-api-key", "wrong-service-key");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key invalid or revoked" });
    expect(findAllSpy).not.toHaveBeenCalled();
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
    expect(findAllSpy).not.toHaveBeenCalled();
  });

  it("protects mutating API v1 routes before request validation", async () => {
    const res = await request(app)
      .patch("/api/v1/streams/not-a-uuid")
      .send({ status: "paused" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
  });

  it("rejects missing API keys before parsing malformed JSON", async () => {
    const res = await request(app)
      .patch("/api/v1/streams/550e8400-e29b-41d4-a716-446655440000")
      .set("Content-Type", "application/json")
      .send('{"status":');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key missing" });
  });

  it("returns JSON parse errors only after API key auth succeeds", async () => {
    const res = await request(app)
      .patch("/api/v1/streams/550e8400-e29b-41d4-a716-446655440000")
      .set("x-api-key", "valid-service-key")
      .set("Content-Type", "application/json")
      .send('{"status":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    });
  });

  it("rejects non-object PATCH bodies after API key auth succeeds", async () => {
    const res = await request(app)
      .patch("/api/v1/streams/550e8400-e29b-41d4-a716-446655440000")
      .set("x-api-key", "valid-service-key")
      .send(["not", "an", "object"]);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Request body must be a JSON object" });
  });

  it("uses timingSafeEqual in validation", async () => {
    const timingSpy = jest.spyOn(crypto, "timingSafeEqual");
    const res = await request(app).get("/api/v1/streams").set("x-api-key", "valid-service-key");

    expect(res.status).toBe(200);
    expect(timingSpy).toHaveBeenCalled();
  });

  it("in-memory store can add and resolve hashed keys", () => {
    const store = new ApiKeyStore();
    store.addPlaintextKey("auth-1", "secret-value");

    const isValid = store.findKeyByValue("secret-value");
    expect(isValid).not.toBeNull();
    expect(isValid?.id).toBe("auth-1");
    expect(isValid?.hash).toBe(hashApiKey("secret-value"));
  });

  it("scans all configured records without short-circuiting on the first match", () => {
    const store = new ApiKeyStore();
    store.addPlaintextKey("auth-1", "secret-value");
    store.addPlaintextKey("auth-2", "rotated-secret", true);
    const timingSpy = jest.spyOn(crypto, "timingSafeEqual");

    const isValid = store.findKeyByValue("secret-value");

    expect(isValid?.id).toBe("auth-1");
    expect(timingSpy).toHaveBeenCalledTimes(2);
  });

  it("returns defensive copies of key records", () => {
    const store = new ApiKeyStore();
    const created = store.addPlaintextKey("auth-1", "secret-value");
    created.revoked = true;

    const resolved = store.findKeyByValue("secret-value");
    expect(resolved?.id).toBe("auth-1");

    if (resolved) {
      resolved.revoked = true;
    }
    expect(store.findKeyByValue("secret-value")?.id).toBe("auth-1");
  });

  it("rejects malformed hash records", () => {
    const store = new ApiKeyStore();

    expect(() => {
      store.addKeyRecord({ id: "bad-hash", hash: "not-a-sha256-hex-digest", revoked: false });
    }).toThrow("SHA-256 hex digest");
  });
});
