import { NewSettlementOutbox, SettlementOutbox } from "../db/schema";
import {
  OutboxClaim,
  SettlementOutboxStore,
} from "../repositories/settlementOutboxRepository";

export type SettlementSideEffect = {
  eventKey: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
};

export type SideEffectHandler = (event: OutboxClaim) => Promise<void>;

export const OUTBOX_BATCH_SIZE = 50;
export const OUTBOX_LEASE_MS = 60_000;
export const OUTBOX_BASE_RETRY_MS = 5_000;
export const OUTBOX_MAX_RETRY_MS = 15 * 60_000;

/**
 * Coordinates durable side effects after a settlement state change.
 * Callers must enqueue through the same database transaction that changes the
 * settlement aggregate; delivery is intentionally separate and retryable.
 */
export class SettlementOutboxService {
  constructor(
    private readonly store: SettlementOutboxStore,
    private readonly handlers: ReadonlyMap<
      string,
      SideEffectHandler
    > = new Map(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async enqueue(effect: SettlementSideEffect): Promise<SettlementOutbox> {
    if (!effect.eventKey.trim())
      throw new Error("Settlement outbox eventKey is required");
    if (!effect.eventType.trim())
      throw new Error("Settlement outbox eventType is required");
    if (!effect.aggregateId.trim())
      throw new Error("Settlement outbox aggregateId is required");
    const input: NewSettlementOutbox = {
      eventKey: effect.eventKey,
      eventType: effect.eventType,
      aggregateId: effect.aggregateId,
      payload: effect.payload,
      maxAttempts: effect.maxAttempts ?? 8,
      availableAt: this.clock(),
    };
    return this.store.enqueue(input);
  }

  async processDue(
    limit = OUTBOX_BATCH_SIZE,
  ): Promise<{
    succeeded: number;
    retried: number;
    dead: number;
    skipped: number;
  }> {
    const claims = await this.store.claimDue(
      limit,
      OUTBOX_LEASE_MS,
      this.clock(),
    );
    const summary = { succeeded: 0, retried: 0, dead: 0, skipped: 0 };
    for (const claim of claims) {
      const handler = this.handlers.get(claim.eventType);
      if (!handler) {
        const dead = await this.store.markFailed(
          claim.id,
          claim.leaseToken,
          `No handler registered for ${claim.eventType}`,
          this.clock(),
          true,
        );
        if (dead) summary.dead += 1;
        else summary.skipped += 1;
        continue;
      }
      try {
        await handler(claim);
        if (
          await this.store.markSucceeded(
            claim.id,
            claim.leaseToken,
            this.clock(),
          )
        )
          summary.succeeded += 1;
        else summary.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDead = claim.attempts >= claim.maxAttempts;
        const retryAt = new Date(
          this.clock().getTime() + retryDelay(claim.attempts),
        );
        if (
          await this.store.markFailed(
            claim.id,
            claim.leaseToken,
            message,
            retryAt,
            isDead,
          )
        ) {
          if (isDead) summary.dead += 1;
          else summary.retried += 1;
        } else summary.skipped += 1;
      }
    }
    return summary;
  }
}

export function retryDelay(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(attempt, 20));
  return Math.min(
    OUTBOX_BASE_RETRY_MS * 2 ** (safeAttempt - 1),
    OUTBOX_MAX_RETRY_MS,
  );
}
