import { Stream } from "../db/schema";

/**
 * Result of an accrual calculation.
 */
export interface AccrualResult {
  streamId: string;
  accruedAmount: string;
  calculationTimestamp: Date;
  status: string;
}

/**
 * Service responsible for computing estimated accrued amounts for streams.
 */
export class AccrualService {
  /**
   * Calculates the estimated accrued amount since the last settlement.
   * 
   * Formula: accrued = ratePerSecond * max(0, min(now, endTime) - lastSettledAt)
   * 
   * @param stream - The stream object from the database.
   * @param now - The reference timestamp (defaults to current time).
   * @returns An AccrualResult containing the calculated estimate.
   */
  calculateAccrual(stream: Stream, now: Date = new Date()): AccrualResult {
    const lastSettledAt = new Date(stream.lastSettledAt);
    const endTime = stream.endTime ? new Date(stream.endTime) : null;

    // If the stream is not active, accrued amount since last settlement might be 0 
    // unless it was settled before it was paused/cancelled.
    // However, for a "preview", if it's not active, we generally return 0 
    // or the amount accrued up to the point it stopped being active.
    // The current schema doesn't have a 'pausedAt' field, so we rely on lastSettledAt.
    
    if (stream.status !== "active") {
      return {
        streamId: stream.id,
        accruedAmount: "0.000000000",
        calculationTimestamp: now,
        status: stream.status,
      };
    }

    // Determine the end of the calculation period (now or endTime)
    const effectiveEnd = endTime && now > endTime ? endTime : now;

    // Calculate elapsed seconds since last settlement
    const elapsedSeconds = Math.max(0, (effectiveEnd.getTime() - lastSettledAt.getTime()) / 1000);
    
    // Parse rate
    const rate = parseFloat(stream.ratePerSecond);
    
    // Calculate total accrued
    const accruedAmount = (elapsedSeconds * rate).toFixed(9);

    return {
      streamId: stream.id,
      accruedAmount,
      calculationTimestamp: now,
      status: stream.status,
    };
  }
}

export const accrualService = new AccrualService();
