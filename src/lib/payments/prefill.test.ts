import { describe, it, expect } from "vitest";
import { resolveDefaultAmountCents } from "./prefill";

describe("resolveDefaultAmountCents", () => {
  it("prefers the per-service price for the engagement type", () => {
    expect(
      resolveDefaultAmountCents({ t1: 35000, t2: 90000 }, "t1", 12345),
    ).toBe(35000);
  });

  it("falls back to the last amount when there's no per-service price", () => {
    expect(resolveDefaultAmountCents({ t2: 90000 }, "t1", 12345)).toBe(12345);
  });

  it("returns null when neither a service price nor a last amount is set", () => {
    expect(resolveDefaultAmountCents({}, "t1", null)).toBeNull();
    expect(resolveDefaultAmountCents(null, "custom", undefined)).toBeNull();
  });

  it("ignores non-positive / non-finite service prices, using the last amount", () => {
    expect(resolveDefaultAmountCents({ t1: 0 }, "t1", 5000)).toBe(5000);
    expect(resolveDefaultAmountCents({ t1: -5 }, "t1", null)).toBeNull();
  });
});
