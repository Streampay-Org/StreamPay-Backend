import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  NewSettlementOutbox,
  SettlementOutbox,
  settlementOutbox,
} from "../db/schema";

export type OutboxClaim = SettlementOutbox & { leaseToken: string };

export interface SettlementOutboxStore {
  enqueue(input: NewSettlementOutbox): Promise<SettlementOutbox>;
  claimDue(limit: number, leaseMs: number, now?: Date): Promise<OutboxClaim[]>;
  markSucceeded(
    id: string,
    leaseToken: string,
    processedAt?: Date,
  ): Promise<boolean>;
  markFailed(
    id: string,
    leaseToken: string,
    error: string,
    retryAt: Date,
    dead: boolean,
  ): Promise<boolean>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function asOutboxRow(row: Record<string, unknown>): SettlementOutbox {
  return {
    id: String(row.id),
    eventKey: String(row.event_key),
    eventType: String(row.event_type),
    aggregateId: String(row.aggregate_id),
    payload: row.payload as Record<string, unknown>,
    status: row.status as SettlementOutbox["status"],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: new Date(String(row.available_at)),
    leaseUntil: row.lease_until ? new Date(String(row.lease_until)) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    processedAt: row.processed_at ? new Date(String(row.processed_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

/** PostgreSQL implementation. Claiming is one statement, so two workers cannot claim the same row. */
export class SettlementOutboxRepository implements SettlementOutboxStore {
  async enqueue(input: NewSettlementOutbox): Promise<SettlementOutbox> {
    try {
      const [row] = await db.insert(settlementOutbox).values(input).returning();
      if (!row) throw new Error("Outbox insert did not return a row");
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [existing] = await db
        .select()
        .from(settlementOutbox)
        .where(eq(settlementOutbox.eventKey, String(input.eventKey)))
        .limit(1);
      if (!existing)
        throw new Error("Outbox event key already exists but cannot be read");
      return existing;
    }
  }

  async claimDue(
    limit = 50,
    leaseMs = 60_000,
    now = new Date(),
  ): Promise<OutboxClaim[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const leaseUntil = new Date(now.getTime() + Math.max(1_000, leaseMs));
    const leaseToken = cryptoRandomToken();
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM settlement_outbox
        WHERE (
          (status = 'pending' AND available_at <= ${now})
          OR (status = 'processing' AND lease_until < ${now})
        )
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}
      )
      UPDATE settlement_outbox AS outbox
      SET status = 'processing', lease_until = ${leaseUntil}, lease_token = ${leaseToken},
          updated_at = ${now}
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.*
    `);

    return (result.rows as Record<string, unknown>[]).map((row) => ({
      ...asOutboxRow(row),
      leaseToken,
    }));
  }

  async markSucceeded(
    id: string,
    leaseToken: string,
    processedAt = new Date(),
  ): Promise<boolean> {
    const result = await db
      .update(settlementOutbox)
      .set({
        status: "succeeded",
        leaseUntil: null,
        leaseToken: null,
        processedAt,
        updatedAt: processedAt,
      })
      .where(
        and(
          eq(settlementOutbox.id, id),
          eq(settlementOutbox.leaseToken, leaseToken),
        ),
      );
    return result.rowCount === 1;
  }

  async markFailed(
    id: string,
    leaseToken: string,
    error: string,
    retryAt: Date,
    dead: boolean,
  ): Promise<boolean> {
    const now = new Date();
    const result = await db
      .update(settlementOutbox)
      .set({
        status: dead ? "dead" : "pending",
        availableAt: retryAt,
        leaseUntil: null,
        leaseToken: null,
        lastError: error.slice(0, 4_000),
        updatedAt: now,
      })
      .where(
        and(
          eq(settlementOutbox.id, id),
          eq(settlementOutbox.leaseToken, leaseToken),
        ),
      );
    return result.rowCount === 1;
  }
}

function cryptoRandomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

type MemoryRow = SettlementOutbox & { leaseToken: string | null };

/** Deterministic store used by tests and local workers without a PostgreSQL instance. */
export class InMemorySettlementOutboxStore implements SettlementOutboxStore {
  private readonly rows = new Map<string, MemoryRow>();
  private readonly keys = new Map<string, string>();
  private sequence = 0;

  async enqueue(input: NewSettlementOutbox): Promise<SettlementOutbox> {
    const existingId = this.keys.get(String(input.eventKey));
    if (existingId) return this.rows.get(existingId)!;
    const now = new Date();
    const row: MemoryRow = {
      id: input.id ?? `memory-outbox-${++this.sequence}`,
      eventKey: String(input.eventKey),
      eventType: String(input.eventType),
      aggregateId: String(input.aggregateId),
      payload: input.payload ?? {},
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 8,
      availableAt: input.availableAt ?? now,
      leaseUntil: input.leaseUntil ?? null,
      leaseToken: input.leaseToken ?? null,
      lastError: input.lastError ?? null,
      processedAt: input.processedAt ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.rows.set(row.id, row);
    this.keys.set(row.eventKey, row.id);
    return { ...row };
  }

  async claimDue(
    limit = 50,
    leaseMs = 60_000,
    now = new Date(),
  ): Promise<OutboxClaim[]> {
    const claimed: OutboxClaim[] = [];
    for (const row of [...this.rows.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      if (claimed.length >= Math.max(1, Math.min(limit, 500))) break;
      const due =
        (row.status === "pending" && row.availableAt <= now) ||
        (row.status === "processing" &&
          !!row.leaseUntil &&
          row.leaseUntil < now);
      if (!due) continue;
      const token = `lease-${row.id}-${++this.sequence}`;
      row.status = "processing";
      row.leaseUntil = new Date(now.getTime() + Math.max(1_000, leaseMs));
      row.leaseToken = token;
      row.updatedAt = now;
      row.attempts += 1;
      claimed.push({ ...row, leaseToken: token });
    }
    return claimed;
  }

  async markSucceeded(
    id: string,
    leaseToken: string,
    processedAt = new Date(),
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== "processing" || row.leaseToken !== leaseToken)
      return false;
    row.status = "succeeded";
    row.leaseUntil = null;
    row.leaseToken = null;
    row.processedAt = processedAt;
    row.updatedAt = processedAt;
    return true;
  }

  async markFailed(
    id: string,
    leaseToken: string,
    error: string,
    retryAt: Date,
    dead: boolean,
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== "processing" || row.leaseToken !== leaseToken)
      return false;
    row.status = dead ? "dead" : "pending";
    row.availableAt = retryAt;
    row.leaseUntil = null;
    row.leaseToken = null;
    row.lastError = error.slice(0, 4_000);
    row.updatedAt = new Date();
    return true;
  }

  snapshot(): SettlementOutbox[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}
