/**
 * Tests for src/cache/redis.ts and src/services/streamCache.ts
 *
 * Strategy: mock the `redis` npm package so no real Redis process is needed.
 * Every branch (miss, hit, connection error, no REDIS_URL) is covered.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// ─── Shared mock state ────────────────────────────────────────────────────────

const store: Record<string, string> = {};
const mockOn = jest.fn();
let connectShouldThrow = false;

const mockRedisClient = {
  on: mockOn,
  connect: jest.fn(async () => {
    if (connectShouldThrow) throw new Error("ECONNREFUSED");
  }),
  get: jest.fn(async (key: string) => store[key] ?? null),
  set: jest.fn(async (key: string, value: string) => {
    store[key] = value;
    return "OK";
  }),
  del: jest.fn(async (key: string) => {
    const existed = key in store ? 1 : 0;
    delete store[key];
    return existed;
  }),
  quit: jest.fn(async () => {}),
  isOpen: true,
};

jest.mock("redis", () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resetModules() {
  jest.resetModules();
  Object.keys(store).forEach((k) => delete store[k]);
  connectShouldThrow = false;
  mockRedisClient.connect.mockClear();
  mockRedisClient.get.mockClear();
  mockRedisClient.set.mockClear();
  mockRedisClient.del.mockClear();
  mockRedisClient.quit.mockClear();
  mockOn.mockClear();
}

// ─── redis.ts tests ───────────────────────────────────────────────────────────

describe("getRedisClient", () => {
  beforeEach(resetModules);
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("returns null when REDIS_URL is not set", async () => {
    delete process.env.REDIS_URL;
    const { getRedisClient } = await import("../cache/redis");
    const result = await getRedisClient();
    expect(result).toBeNull();
  });

  it("returns a connected client when REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getRedisClient } = await import("../cache/redis");
    const client = await getRedisClient();
    expect(client).not.toBeNull();
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not throw when connect fails", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    connectShouldThrow = true;
    const { getRedisClient } = await import("../cache/redis");
    const client = await getRedisClient();
    expect(client).toBeNull();
  });

  it("reuses the singleton on subsequent calls", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getRedisClient } = await import("../cache/redis");
    await getRedisClient();
    await getRedisClient();
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
  });
});

describe("closeRedisClient", () => {
  beforeEach(resetModules);
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("calls quit and resets state", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getRedisClient, closeRedisClient } = await import("../cache/redis");
    await getRedisClient();
    await closeRedisClient();
    expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
    // After close, next call should reconnect
    await getRedisClient();
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(2);
  });

  it("does not throw if client was never created", async () => {
    const { closeRedisClient } = await import("../cache/redis");
    await expect(closeRedisClient()).resolves.toBeUndefined();
  });
});

// ─── streamCache.ts tests ─────────────────────────────────────────────────────

describe("getCachedStream", () => {
  beforeEach(resetModules);
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("returns null on cache miss", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getCachedStream } = await import("../services/streamCache");
    const result = await getCachedStream("stream_missing");
    expect(result).toBeNull();
  });

  it("returns parsed data on cache hit", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const payload = { id: "stream_1", amount: "42" };
    store["stream:stream_1"] = JSON.stringify(payload);
    const { getCachedStream } = await import("../services/streamCache");
    const result = await getCachedStream<typeof payload>("stream_1");
    expect(result).toEqual(payload);
  });

  it("returns null and does not throw when Redis is unavailable", async () => {
    delete process.env.REDIS_URL;
    const { getCachedStream } = await import("../services/streamCache");
    await expect(getCachedStream("stream_1")).resolves.toBeNull();
  });

  it("returns null and logs when get throws", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRedisClient.get.mockRejectedValueOnce(new Error("timeout") as never);
    const { getCachedStream } = await import("../services/streamCache");
    const result = await getCachedStream("stream_err");
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("setCachedStream", () => {
  beforeEach(resetModules);
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("stores serialised data in Redis with EX option", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { setCachedStream } = await import("../services/streamCache");
    await setCachedStream("stream_2", { id: "stream_2" });
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      "stream:stream_2",
      JSON.stringify({ id: "stream_2" }),
      { EX: 60 }
    );
  });

  it("respects a custom TTL", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { setCachedStream } = await import("../services/streamCache");
    await setCachedStream("stream_3", { id: "stream_3" }, 120);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      "stream:stream_3",
      expect.any(String),
      { EX: 120 }
    );
  });

  it("does not throw when Redis is unavailable", async () => {
    delete process.env.REDIS_URL;
    const { setCachedStream } = await import("../services/streamCache");
    await expect(setCachedStream("stream_4", {})).resolves.toBeUndefined();
  });

  it("swallows and logs set errors", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRedisClient.set.mockRejectedValueOnce(new Error("OOM") as never);
    const { setCachedStream } = await import("../services/streamCache");
    await expect(setCachedStream("stream_5", {})).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("invalidateCachedStream", () => {
  beforeEach(resetModules);
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("deletes the key from Redis", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    store["stream:stream_6"] = "{}";
    const { invalidateCachedStream } = await import("../services/streamCache");
    await invalidateCachedStream("stream_6");
    expect(mockRedisClient.del).toHaveBeenCalledWith("stream:stream_6");
  });

  it("does not throw when Redis is unavailable", async () => {
    delete process.env.REDIS_URL;
    const { invalidateCachedStream } = await import("../services/streamCache");
    await expect(invalidateCachedStream("stream_7")).resolves.toBeUndefined();
  });

  it("swallows and logs del errors", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRedisClient.del.mockRejectedValueOnce(new Error("READONLY") as never);
    const { invalidateCachedStream } = await import("../services/streamCache");
    await expect(invalidateCachedStream("stream_8")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

//