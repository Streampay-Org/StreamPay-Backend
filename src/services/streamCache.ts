import { getRedisClient } from "../cache/redis";

const STREAM_TTL_SECONDS = 60; // 1-minute TTL — tune via env if needed
const KEY_PREFIX = "stream:";

function streamKey(streamId: string): string {
  return `${KEY_PREFIX}${streamId}`;
}

/**
 * Retrieve a cached stream by ID.
 * Returns the parsed object, or null on cache miss / Redis unavailable.
 */
export async function getCachedStream<T>(streamId: string): Promise<T | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;

    const raw = await redis.get(streamKey(streamId));
    if (!raw) return null;

    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[streamCache] get error for ${streamId}:`, msg);
    return null; // degrade gracefully
  }
}

/**
 * Store a stream in the cache with the default TTL.
 * Failures are logged and swallowed — callers are unaffected.
 */
export async function setCachedStream<T>(
  streamId: string,
  data: T,
  ttlSeconds = STREAM_TTL_SECONDS
): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (!redis) return;

    await redis.set(streamKey(streamId), JSON.stringify(data), {
      EX: ttlSeconds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[streamCache] set error for ${streamId}:`, msg);
  }
}

/**
 * Invalidate a single stream's cache entry.
 * Called on updates and incoming webhook events to keep data consistent.
 */
export async function invalidateCachedStream(streamId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (!redis) return;

    await redis.del(streamKey(streamId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[streamCache] invalidate error for ${streamId}:`, msg);
  }
}

//