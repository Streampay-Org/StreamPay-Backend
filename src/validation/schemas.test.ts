import {
  stellarAddressSchema,
  decimalAmountSchema,
  uuidSchema,
  getStreamsQuerySchema,
  uuidParamSchema,
} from "./schemas";

describe("stellarAddressSchema", () => {
  const valid = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it.each([
    ["valid Stellar address", valid, true],
    ["too short", "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567", false],
    ["too long", valid + "A", false],
    ["does not start with G", "LABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["contains lowercase", "gABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["contains invalid char 0", "G0BCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["contains invalid char 1", "G1BCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["contains invalid char 8", "G8BCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["contains invalid char 9", "G9BCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23", false],
    ["empty string", "", false],
  ])("%s", (_label, input, expectedValid) => {
    const result = stellarAddressSchema.safeParse(input);
    expect(result.success).toBe(expectedValid);
  });
});

describe("decimalAmountSchema", () => {
  it.each([
    ["integer", "100", true],
    ["decimal with 1 fractional digit", "0.1", true],
    ["decimal with 9 fractional digits", "123.123456789", true],
    ["large number", "99999999999999999999", true],
    ["small positive", "0.000000001", true],
    ["zero", "0", false],
    ["negative", "-5", false],
    ["too many fractional digits (10)", "1.1234567890", false],
    ["not a number", "abc", false],
    ["empty string", "", false],
    ["empty after decimal", "1.", false],
    ["leading zero", "0.5", true],
  ])("%s", (_label, input, expectedValid) => {
    const result = decimalAmountSchema.safeParse(input);
    expect(result.success).toBe(expectedValid);
  });
});

describe("uuidSchema", () => {
  it.each([
    ["valid UUID v4", "550e8400-e29b-411d-a716-446655440000", true],
    ["valid UUID with uppercase", "550E8400-E29B-411D-A716-446655440000", true],
    ["invalid: not a UUID", "not-a-uuid", false],
    ["invalid: wrong format", "123e4567-e89b-12d3-a456", false],
    ["empty string", "", false],
  ])("%s", (_label, input, expectedValid) => {
    const result = uuidSchema.safeParse(input);
    expect(result.success).toBe(expectedValid);
  });
});

describe("getStreamsQuerySchema", () => {
  it("accepts empty query", () => {
    const result = getStreamsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid filter fields", () => {
    const result = getStreamsQuerySchema.safeParse({
      payer: "GPAYER",
      recipient: "GRECIPIENT",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = getStreamsQuerySchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("coerces numeric limit", () => {
    const result = getStreamsQuerySchema.safeParse({ limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });
});

describe("uuidParamSchema", () => {
  it("accepts a valid UUID", () => {
    const result = uuidParamSchema.safeParse({ id: "550e8400-e29b-411d-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid UUID", () => {
    const result = uuidParamSchema.safeParse({ id: "bad-id" });
    expect(result.success).toBe(false);
  });
});
