import { AccrualService } from "./accrualService";
import { Stream } from "../db/schema";

describe("AccrualService", () => {
  let accrualService: AccrualService;

  beforeEach(() => {
    accrualService = new AccrualService();
  });

  const mockStreamBase = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    payer: "payer1",
    recipient: "recipient1",
    status: "active",
    ratePerSecond: "1.5",
    startTime: new Date("2026-03-30T10:00:00Z"),
    endTime: null,
    lastSettledAt: new Date("2026-03-30T10:00:00Z"),
    totalAmount: "1000",
    createdAt: new Date("2026-03-30T10:00:00Z"),
    updatedAt: new Date("2026-03-30T10:00:00Z"),
  } as unknown as Stream;

  it("should calculate correctly for an active stream (10 seconds elapsed)", () => {
    const now = new Date("2026-03-30T10:00:10Z");
    const result = accrualService.calculateAccrual(mockStreamBase, now);

    expect(result.accruedAmount).toBe("15.000000000"); // 10 * 1.5
    expect(result.streamId).toBe(mockStreamBase.id);
    expect(result.status).toBe("active");
  });

  it("should calculate correctly for an active stream (1 hour elapsed)", () => {
    const now = new Date("2026-03-30T11:00:00Z");
    const result = accrualService.calculateAccrual(mockStreamBase, now);

    expect(result.accruedAmount).toBe("5400.000000000"); // 3600 * 1.5
  });

  it("should cap at endTime if now is after endTime", () => {
    const streamWithEnd = {
      ...mockStreamBase,
      endTime: new Date("2026-03-30T10:10:00Z"), // 600 seconds from start
    } as unknown as Stream;

    const now = new Date("2026-03-30T10:15:00Z"); // 300 seconds after endTime
    const result = accrualService.calculateAccrual(streamWithEnd, now);

    expect(result.accruedAmount).toBe("900.000000000"); // 600 * 1.5
  });

  it("should return 0 for a paused stream", () => {
    const pausedStream = {
      ...mockStreamBase,
      status: "paused",
    } as unknown as Stream;

    const now = new Date("2026-03-30T10:00:10Z");
    const result = accrualService.calculateAccrual(pausedStream, now);

    expect(result.accruedAmount).toBe("0.000000000");
  });

  it("should return 0 for a cancelled stream", () => {
    const cancelledStream = {
      ...mockStreamBase,
      status: "cancelled",
    } as unknown as Stream;

    const now = new Date("2026-03-30T10:00:10Z");
    const result = accrualService.calculateAccrual(cancelledStream, now);

    expect(result.accruedAmount).toBe("0.000000000");
  });

  it("should return 0 if now is before lastSettledAt", () => {
    const now = new Date("2026-03-30T09:59:50Z"); // 10 seconds before start
    const result = accrualService.calculateAccrual(mockStreamBase, now);

    expect(result.accruedAmount).toBe("0.000000000");
  });

  it("should handle large numbers correctly with toFixed(9)", () => {
    const richStream = {
      ...mockStreamBase,
      ratePerSecond: "1234.567890123",
    } as unknown as Stream;

    const now = new Date("2026-03-30T10:00:10Z");
    const result = accrualService.calculateAccrual(richStream, now);

    expect(result.accruedAmount).toBe("12345.678901230");
  });
});
