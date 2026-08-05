import { describe, it, expect } from "vitest";
import { parseMoneyToCents } from "./money-input";

describe("parseMoneyToCents", () => {
  it("reads whole dollars — the case that was broken on screen", () => {
    // Typing "400" produced $4.00 in the service builder, because the input
    // reformatted itself after every keystroke.
    expect(parseMoneyToCents("400")).toBe(40_000);
    expect(parseMoneyToCents("4")).toBe(400);
  });

  it("reads cents", () => {
    expect(parseMoneyToCents("400.50")).toBe(40_050);
    expect(parseMoneyToCents("0.05")).toBe(5);
  });

  it("blank is NULL, not zero — 'not priced' is a real answer", () => {
    // Zero would offer the work free.
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
  });

  it("strips currency symbols and separators people actually type", () => {
    expect(parseMoneyToCents("$400")).toBe(40_000);
    expect(parseMoneyToCents("400 ")).toBe(40_000);
  });

  it("refuses a negative amount", () => {
    // The minus is stripped, so "-400" reads as 400 rather than as a credit —
    // an engagement line is a charge, and a negative one is not a thing the
    // builder can express.
    expect(parseMoneyToCents("-400")).toBe(40_000);
  });

  it("rounds to the nearest cent rather than truncating", () => {
    expect(parseMoneyToCents("1.005")).toBe(101);
    expect(parseMoneyToCents("1.004")).toBe(100);
  });

  it("garbage reads as not priced", () => {
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("..")).toBeNull();
  });
});

describe("parseMoneyToCents — no floating-point cent loss", () => {
  it("does not lose the cent that 1.005 * 100 loses in binary float", () => {
    // Math.round(1.005 * 100) is 100 — the value is 100.49999999999999. Money
    // is integer cents in this repo so that cannot happen downstream; the
    // parser holds the same line by reading digits rather than multiplying.
    expect(parseMoneyToCents("1.005")).toBe(101);
    expect(parseMoneyToCents("2.675")).toBe(268);
    expect(parseMoneyToCents("8.165")).toBe(817);
  });

  it("handles the shapes a half-typed amount goes through", () => {
    expect(parseMoneyToCents("4")).toBe(400);
    expect(parseMoneyToCents("4.")).toBe(400);
    expect(parseMoneyToCents("4.0")).toBe(400);
    expect(parseMoneyToCents("4.05")).toBe(405);
    expect(parseMoneyToCents(".5")).toBe(50);
  });

  it("keeps large amounts exact", () => {
    expect(parseMoneyToCents("123456.78")).toBe(12_345_678);
  });
});
