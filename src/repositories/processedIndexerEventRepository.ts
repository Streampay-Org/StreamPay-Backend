import { db } from "../db/index";
import { processedIndexerEvents } from "../db/schema";
import { eq } from "drizzle-orm";

export type ProcessedIndexerEventStatus = "processing" | "completed" | "failed";

export type ProcessedIndexerEventClaim =
  | { kind: "claimed" }
  | { kind: "duplicate" }
  | { kind: "in_progress" }
  | { kind: "conflict" };

export interface ProcessedIndexerEventStore {
  claim(eventId: string, fingerprint: string): Promise<ProcessedIndexerEventClaim>;
  complete(eventId: string): Promise<void>;
  fail(eventId: string): Promise<void>;
  reset(): Promise<void>;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

export class ProcessedIndexerEventRepository implements ProcessedIndexerEventStore {
  async claim(eventId: string, fingerprint: string): Promise<ProcessedIndexerEventClaim> {
    try {
      await db
        .insert(processedIndexerEvents)
        .values({ eventId, payloadHash: fingerprint, status: "processing" })
        .onConflictDoNothing({ target: processedIndexerEvents.eventId });
      const [existing] = await db
        .select({ payloadHash: processedIndexerEvents.payloadHash, status: processedIndexerEvents.status })
        .from(processedIndexerEvents)
        .where(eq(processedIndexerEvents.eventId, eventId));

      if (!existing || existing.payloadHash !== fingerprint) return { kind: "conflict" };
      if (existing.status === "completed") return { kind: "duplicate" };
      if (existing.status === "processing") return { kind: "in_progress" };
      return { kind: "claimed" };
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: "in_progress" };
      throw error;
    }
  }

  async complete(eventId: string): Promise<void> {
    await db
      .update(processedIndexerEvents)
      .set({ status: "completed" })
      .where(eq(processedIndexerEvents.eventId, eventId));
  }

  async fail(eventId: string): Promise<void> {
    await db
      .update(processedIndexerEvents)
      .set({ status: "failed" })
      .where(eq(processedIndexerEvents.eventId, eventId));
  }

  async reset(): Promise<void> {
    await db.delete(processedIndexerEvents);
  }
}

export class InMemoryProcessedIndexerEventStore implements ProcessedIndexerEventStore {
  private readonly events = new Map<string, { fingerprint: string; status: ProcessedIndexerEventStatus }>();

  async claim(eventId: string, fingerprint: string): Promise<ProcessedIndexerEventClaim> {
    const existing = this.events.get(eventId);
    if (!existing) {
      this.events.set(eventId, { fingerprint, status: "processing" });
      return { kind: "claimed" };
    }
    if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
    if (existing.status === "completed") return { kind: "duplicate" };
    if (existing.status === "processing") return { kind: "in_progress" };
    existing.status = "processing";
    return { kind: "claimed" };
  }

  async complete(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) event.status = "completed";
  }

  async fail(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) event.status = "failed";
  }

  async reset(): Promise<void> {
    this.events.clear();
  }
}
