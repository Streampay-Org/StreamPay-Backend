import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index";
import { Stream, streams } from "../db/schema";

/**
 * Filters for {@link StreamRepository.findAll}.
 *
 * All filter fields are optional and combined with AND semantics; omit a
 * field to skip filtering on it.
 */
export interface FindAllParams {
  /** Restrict to streams paid out by this address. */
  payer?: string;
  /** Restrict to streams paid out to this address. */
  recipient?: string;
  /** Restrict to streams in a specific lifecycle status. */
  status?: "active" | "paused" | "cancelled" | "completed";
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of rows to skip; pairs with `limit` for offset pagination. */
  offset?: number;
  /** When true, include soft-deleted rows (admin / inspection only). */
  includeDeleted?: boolean;
}

/**
 * Patch payload accepted by {@link StreamRepository.updateById}.
 *
 * Only the supplied fields are written; missing fields are left untouched.
 */
export interface UpdateStreamParams {
  labels?: string[];
  offChainMemo?: string | null;
  status?: "active" | "paused" | "cancelled" | "completed";
  updatedAt?: Date;
}

export interface ExportParams {
  payer?: string;
  recipient?: string;
  status?: "active" | "paused" | "cancelled" | "completed";
  /** Exclusive cursor: resume after this (createdAt, id) pair (both must be set together). */
  cursorCreatedAt?: Date;
  cursorId?: string;
  /** Number of rows per DB fetch (default 500). */
  batchSize?: number;
}

export interface ExportBatch {
  rows: Stream[];
  /** null when this is the last page. */
  nextCursor: { createdAt: Date; id: string } | null;
}

export class StreamRepository {
  async findById(id: string, includeDeleted = false): Promise<(Stream & { accruedEstimate: string }) | null> {
    const conditions: SQL[] = [eq(streams.id, id)];
    if (!includeDeleted) conditions.push(sql`${streams.deletedAt} IS NULL`);

    const [result] = await db
      .select()
      .from(streams)
      .where(and(...conditions))
      .limit(1);

    if (!result) return null;

    const accruedEstimate = this.calculateAccruedEstimate(result);

    return {
      ...result,
      accruedEstimate: accruedEstimate.toString(),
    };
  }

  async findAll(params: FindAllParams = {}) {
    const limit = Math.min(params.limit ?? 20, 100);
    const offset = params.offset ?? 0;

    const conditions: SQL[] = [];
    if (params.payer) conditions.push(eq(streams.payer, params.payer));
    if (params.recipient) conditions.push(eq(streams.recipient, params.recipient));
    if (params.status) conditions.push(eq(streams.status, params.status));

    if (!params.includeDeleted) {
      conditions.push(sql`${streams.deletedAt} IS NULL`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select()
      .from(streams)
      .where(whereClause)
      .orderBy(desc(streams.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(streams)
      .where(whereClause);

    return {
      streams: data,
      total: Number(countResult?.count ?? 0),
      limit,
      offset,
    };
  }

  async updateById(id: string, updates: UpdateStreamParams, currentUpdatedAt?: Date): Promise<Stream | null> {
    const updateData: Partial<Stream> = {
      ...updates,
      updatedAt: new Date(),
    };

    const conditions: SQL[] = [eq(streams.id, id)];
    if (currentUpdatedAt) {
      conditions.push(eq(streams.updatedAt, currentUpdatedAt));
    }

    const result = await db
      .update(streams)
      .set(updateData)
      .where(and(...conditions))
      .returning();

    return result[0] ?? null;
  }

  private calculateAccruedEstimate(stream: Stream): number {
    if (stream.status !== "active") return 0;

    const now = new Date();
    const startTime = new Date(stream.lastSettledAt);
    const endTime = stream.endTime ? new Date(stream.endTime) : null;

    const effectiveNow = endTime && now > endTime ? endTime : now;

    const elapsedSeconds = Math.max(0, (effectiveNow.getTime() - startTime.getTime()) / 1000);
    const rate = parseFloat(stream.ratePerSecond);

    return elapsedSeconds * rate;
  }
}
