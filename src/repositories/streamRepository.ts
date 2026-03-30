import { eq, and, or, desc, lt, sql } from "drizzle-orm";
import { db } from "../db/index";
import { streams, Stream } from "../db/schema";

export interface FindAllParams {
  payer?: string;
  recipient?: string;
  status?: "active" | "paused" | "cancelled" | "completed";
  limit?: number;
  offset?: number;
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
  async findById(id: string): Promise<(Stream & { accruedEstimate: string }) | null> {
    const [result] = await db
      .select()
      .from(streams)
      .where(eq(streams.id, id))
      .limit(1);

    if (!result) return null;

    const accruedEstimate = this.calculateAccruedEstimate(result);

    return {
      ...result,
      accruedEstimate: accruedEstimate.toString(),
    };
  }

  async findAll(params: FindAllParams) {
    const limit = Math.min(params.limit ?? 20, 100);
    const offset = params.offset ?? 0;

    const conditions = [];
    if (params.payer) conditions.push(eq(streams.payer, params.payer));
    if (params.recipient) conditions.push(eq(streams.recipient, params.recipient));
    if (params.status) conditions.push(eq(streams.status, params.status));

    const query = db
      .select()
      .from(streams)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(streams.createdAt))
      .limit(limit)
      .offset(offset);

    const data = await query;
    
    // For total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(streams)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      streams: data,
      total: Number(countResult.count),
      limit,
      offset,
    };
  }

  /**
   * Fetches one page of streams for cursor-based export.
   *
   * Ordering: (createdAt DESC, id DESC) — stable because id is a UUID primary key.
   * Cursor semantics: fetch rows that come strictly *after* the cursor position in
   * that ordering, i.e. rows where createdAt < cursorCreatedAt, or where
   * createdAt == cursorCreatedAt and id < cursorId.
   *
   * Returns nextCursor = null when this is the final page.
   */
  async findForExport(params: ExportParams): Promise<ExportBatch> {
    const batchSize = params.batchSize ?? 500;

    // Build filter conditions
    const conditions = [];
    if (params.payer) conditions.push(eq(streams.payer, params.payer));
    if (params.recipient) conditions.push(eq(streams.recipient, params.recipient));
    if (params.status) conditions.push(eq(streams.status, params.status));

    // Keyset / cursor condition
    if (params.cursorCreatedAt !== undefined && params.cursorId !== undefined) {
      const cursorCond = or(
        lt(streams.createdAt, params.cursorCreatedAt),
        and(
          eq(streams.createdAt, params.cursorCreatedAt),
          lt(streams.id, params.cursorId)
        )
      );
      if (cursorCond) conditions.push(cursorCond);
    }

    // Fetch batchSize + 1 to detect whether a next page exists
    const rows = await db
      .select()
      .from(streams)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(streams.createdAt), desc(streams.id))
      .limit(batchSize + 1);

    if (rows.length <= batchSize) {
      return { rows, nextCursor: null };
    }

    const page = rows.slice(0, batchSize);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: { createdAt: last.createdAt, id: last.id },
    };
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
