import { describe, expect, it } from "vitest";
import { parsePayout, shouldExtractPayout } from "./processor-payout";

describe("shouldExtractPayout", () => {
  it("runs when either the request or the classifier says processor statement", () => {
    expect(shouldExtractPayout("processor_statement", null)).toBe(true);
    expect(shouldExtractPayout("other", "processor_statement")).toBe(true);
    expect(shouldExtractPayout("bank_statement", "bank_statement")).toBe(false);
    expect(shouldExtractPayout(null, null)).toBe(false);
  });
});

describe("parsePayout", () => {
  const clean = {
    processor: "Stripe",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    payout_date: "2026-07-02",
    currency: "cad",
    gross_sales: 5200,
    refunds: 150,
    fees: 237.67,
    fee_tax: null,
    adjustments: null,
    net_payout: 4812.33,
    confidence: 0.93,
    note: "",
  };

  it("parses a clean read", () => {
    expect(parsePayout(clean)).toEqual({
      processor: "Stripe",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      payoutDate: "2026-07-02",
      currency: "CAD",
      grossSales: 5200,
      refunds: 150,
      fees: 237.67,
      feeTax: null,
      adjustments: null,
      netPayout: 4812.33,
      confidence: 0.93,
      note: "",
    });
  });

  it("forces deduction lines positive even if the model signs them", () => {
    const p = parsePayout({ ...clean, refunds: -150, fees: -237.67 });
    expect(p.refunds).toBe(150);
    expect(p.fees).toBe(237.67);
  });

  it("keeps a NEGATIVE net payout — a real refund-heavy month", () => {
    expect(parsePayout({ ...clean, net_payout: -35 }).netPayout).toBe(-35);
  });

  it("preserves an explicit zero as zero, not null", () => {
    const p = parsePayout({ ...clean, refunds: 0, fees: 0 });
    expect(p.refunds).toBe(0);
    expect(p.fees).toBe(0);
  });

  it("nulls malformed numbers and non-ISO dates rather than guessing", () => {
    const p = parsePayout({
      ...clean,
      gross_sales: "lots",
      net_payout: Number.NaN,
      period_start: "June 2026",
      payout_date: "",
    });
    expect(p.grossSales).toBeNull();
    expect(p.netPayout).toBeNull();
    expect(p.periodStart).toBeNull();
    expect(p.payoutDate).toBeNull();
  });

  it("clamps confidence and tolerates a missing one", () => {
    expect(parsePayout({ ...clean, confidence: 5 }).confidence).toBe(1);
    expect(parsePayout({ ...clean, confidence: -2 }).confidence).toBe(0);
    expect(parsePayout({ ...clean, confidence: null }).confidence).toBe(0);
  });

  it("survives an entirely empty object", () => {
    const p = parsePayout({});
    expect(p.grossSales).toBeNull();
    expect(p.netPayout).toBeNull();
    expect(p.processor).toBeNull();
    expect(p.note).toBe("");
  });
});
