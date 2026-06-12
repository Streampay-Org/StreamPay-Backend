import {
  ONE_DAY_MS,
  ONE_HOUR_MS,
  ONE_MINUTE_MS,
  ONE_SECOND_MS,
  elapsedSeconds,
  toIsoUtc,
} from "./time";

describe("time constants", () => {
  it("are consistent with each other", () => {
    expect(ONE_MINUTE_MS).toBe(60 * ONE_SECOND_MS);
    expect(ONE_HOUR_MS).toBe(60 * ONE_MINUTE_MS);
    expect(ONE_DAY_MS).toBe(24 * ONE_HOUR_MS);
  });
});

describe("toIsoUtc", () => {
  it("formats dates in ISO-8601 UTC", () => {
    expect(toIsoUtc(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("elapsedSeconds", () => {
  it("returns the number of whole seconds between dates", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-01T00:00:42.500Z");
    expect(elapsedSeconds(from, to)).toBe(42);
  });

  it("returns 0 when `to` precedes `from`", () => {
    const from = new Date("2026-01-02T00:00:00.000Z");
    const to = new Date("2026-01-01T00:00:00.000Z");
    expect(elapsedSeconds(from, to)).toBe(0);
  });
});
