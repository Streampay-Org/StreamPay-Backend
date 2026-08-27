import { eq, max, sql } from "drizzle-orm";
import { db } from "../db/index";
import { meteringEventCheckpoints } from "../db/schema";

export const MAX_METERING_GAP = 100;

export type MeteringCheckpointDecision =
  | { kind: "accepted"; nextSequence: number }
  | { kind: "duplicate"; nextSequence: number }
  | { kind: "late"; checkpoint: number }
  | { kind: "gap"; expectedSequence: number; receivedSequence: number }
  | { kind: "gap_too_large"; expectedSequence: number; receivedSequence: number };

export interface MeteringCheckpointStore {
  apply(streamId: string, eventId: string, sequence: number): Promise<MeteringCheckpointDecision>;
  reset(): Promise<void>;
}

/**
 * PostgreSQL checkpoint store. The advisory transaction lock serializes
 * sequence decisions per stream while allowing unrelated streams to proceed.
 */
export class MeteringCheckpointRepository implements MeteringCheckpointStore {
  async apply(streamId: string, eventId: string, sequence: number): Promise<MeteringCheckpointDecision> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${streamId}))`);

      const [existing] = await tx
        .select({ sequence: meteringEventCheckpoints.sequence })
        .from(meteringEventCheckpoints)
        .where(eq(meteringEventCheckpoints.eventId, eventId));
      if (existing) return { kind: "duplicate", nextSequence: existing.sequence };

      const [latest] = await tx
        .select({ sequence: max(meteringEventCheckpoints.sequence) })
        .from(meteringEventCheckpoints)
        .where(eq(meteringEventCheckpoints.streamId, streamId));
      const checkpoint = latest?.sequence ?? 0;
      const expectedSequence = checkpoint + 1;

      if (sequence < expectedSequence) return { kind: "late", checkpoint };
      if (sequence > expectedSequence + MAX_METERING_GAP) {
        return { kind: "gap_too_large", expectedSequence, receivedSequence: sequence };
      }
      if (sequence > expectedSequence) {
        return { kind: "gap", expectedSequence, receivedSequence: sequence };
      }

      await tx.insert(meteringEventCheckpoints).values({ streamId, eventId, sequence });
      return { kind: "accepted", nextSequence: sequence };
    });
  }

  async reset(): Promise<void> {
    await db.delete(meteringEventCheckpoints);
  }
}

type InMemoryCheckpoint = { streamId: string; eventId: string; sequence: number };

export class InMemoryMeteringCheckpointStore implements MeteringCheckpointStore {
  private readonly events = new Map<string, InMemoryCheckpoint>();

  async apply(streamId: string, eventId: string, sequence: number): Promise<MeteringCheckpointDecision> {
    const existing = this.events.get(eventId);
    if (existing) return { kind: "duplicate", nextSequence: existing.sequence };

    let checkpoint = 0;
    for (const event of this.events.values()) {
      if (event.streamId === streamId && event.sequence > checkpoint) checkpoint = event.sequence;
    }
    const expectedSequence = checkpoint + 1;
    if (sequence < expectedSequence) return { kind: "late", checkpoint };
    if (sequence > expectedSequence + MAX_METERING_GAP) {
      return { kind: "gap_too_large", expectedSequence, receivedSequence: sequence };
    }
    if (sequence > expectedSequence) {
      return { kind: "gap", expectedSequence, receivedSequence: sequence };
    }

    this.events.set(eventId, { streamId, eventId, sequence });
    return { kind: "accepted", nextSequence: sequence };
  }

  async reset(): Promise<void> {
    this.events.clear();
  }
}
