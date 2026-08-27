import { createClient, RedisClientType } from "redis";
import { markRedisAvailable, markRedisUnavailable, recordRedisStateChange } from "../metrics/prometheus";

let client: RedisClientType | null = null;
let connected = false;
let failureReported = false;

const reportFailure = (): void => {
  connected = false;
  markRedisUnavailable();
  if (!failureReported) {
    recordRedisStateChange("failure");
    failureReported = true;
  }
};

const reportRecovery = (): void => {
  const wasUnavailable = !connected || failureReported;
  connected = true;
  markRedisAvailable();
  if (wasUnavailable && failureReported) recordRedisStateChange("recovery");
  failureReported = false;
};

/**
 * Returns the singleton Redis client, or null if unavailable.
 * Connection errors are logged but never thrown — callers degrade gracefully.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (client && connected) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    // No Redis configured — optional cache/lease features remain disabled.
    markRedisUnavailable();
    return null;
  }

  try {
    const c = createClient({ url }) as RedisClientType;

    c.on("error", (err: Error) => {
      reportFailure();
      console.error("[redis] connection error:", err.message);
    });

    c.on("reconnecting", () => {
      console.warn("[redis] reconnecting…");
    });

    c.on("ready", () => {
      reportRecovery();
    });

    await c.connect();
    reportRecovery();
    client = c;
    return client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[redis] failed to connect, caching disabled:", msg);
    reportFailure();
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
    failureReported = false;
    markRedisUnavailable();
  }
}

export { connected as isRedisConnected };

//
