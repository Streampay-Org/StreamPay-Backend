import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connected = false;

/**
 * Returns the singleton Redis client, or null if unavailable.
 * Connection errors are logged but never thrown — callers degrade gracefully.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (client && connected) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    // No Redis configured — silently skip caching
    return null;
  }

  try {
    const c = createClient({ url }) as RedisClientType;

    c.on("error", (err: Error) => {
      connected = false;
      console.error("[redis] connection error:", err.message);
    });

    c.on("reconnecting", () => {
      console.warn("[redis] reconnecting…");
    });

    c.on("ready", () => {
      connected = true;
    });

    await c.connect();
    connected = true;
    client = c;
    return client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[redis] failed to connect, caching disabled:", msg);
    return null;
  }
}

/** Disconnect and reset — primarily for tests. */
export async function closeRedisClient(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      // ignore errors on teardown
    }
    client = null;
    connected = false;
  }
}

export { connected as isRedisConnected };

//