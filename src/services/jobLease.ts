import crypto from "crypto";
import type { RedisClientType } from "redis";
import { getRedisClient } from "../cache/redis";
import { jobLeaseDecisionsTotal } from "../metrics/prometheus";

export const DEFAULT_JOB_LEASE_TTL_MS = 30_000;
export const JOB_LEASE_PREFIX = "streampay:job-lease:";

/** A lease is the sole permission to process one queued job attempt. */
export interface JobLease {
  acquire(jobId: string, owner: string, ttlMs?: number): Promise<boolean>;
  release(jobId: string, owner: string): Promise<void>;
}

/**
 * Redis-backed lease using SET NX PX and an owner-checked Lua release.
 *
 * Missing Redis is a failed lease, never an implicit claim. The worker can
 * therefore fail closed during an outage without deleting or duplicating
 * queued database work.
 */
export class RedisJobLease implements JobLease {
  constructor(
    private readonly clientProvider: () => Promise<RedisClientType | null> = getRedisClient,
    private readonly randomId: () => string = () => crypto.randomUUID(),
  ) {}

  async acquire(jobId: string, owner: string, ttlMs = DEFAULT_JOB_LEASE_TTL_MS): Promise<boolean> {
    const client = await this.clientProvider();
    if (!client) {
      jobLeaseDecisionsTotal.labels("redis_unavailable").inc();
      return false;
    }

    try {
      const result = await client.set(`${JOB_LEASE_PREFIX}${jobId}`, `${owner}:${this.randomId()}`, {
        NX: true,
        PX: ttlMs,
      });
      const acquired = result === "OK";
      jobLeaseDecisionsTotal.labels(acquired ? "acquired" : "busy").inc();
      return acquired;
    } catch (error) {
      jobLeaseDecisionsTotal.labels("redis_error").inc();
      console.error("[webhook-worker] lease acquisition failed:", error);
      return false;
    }
  }

  async release(jobId: string, owner: string): Promise<void> {
    const client = await this.clientProvider();
    if (!client) {
      jobLeaseDecisionsTotal.labels("release_skipped").inc();
      return;
    }

    try {
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [`${JOB_LEASE_PREFIX}${jobId}`], arguments: [owner] },
      );
      jobLeaseDecisionsTotal.labels("released").inc();
    } catch (error) {
      // A lease expiry is safe: the database row remains pending for a later
      // worker. Never turn release failure into a second attempt in this run.
      jobLeaseDecisionsTotal.labels("release_error").inc();
      console.error("[webhook-worker] lease release failed:", error);
    }
  }
}

/** Deterministic lease implementation used by failure-injection tests. */
export class InMemoryJobLease implements JobLease {
  private readonly owners = new Map<string, string>();

  constructor(private readonly available = true) {}

  async acquire(jobId: string, owner: string): Promise<boolean> {
    if (!this.available) {
      jobLeaseDecisionsTotal.labels("redis_unavailable").inc();
      return false;
    }
    if (this.owners.has(jobId)) {
      jobLeaseDecisionsTotal.labels("busy").inc();
      return false;
    }
    this.owners.set(jobId, owner);
    jobLeaseDecisionsTotal.labels("acquired").inc();
    return true;
  }

  async release(jobId: string, owner: string): Promise<void> {
    if (this.owners.get(jobId) === owner) this.owners.delete(jobId);
  }

  has(jobId: string): boolean {
    return this.owners.has(jobId);
  }
}
