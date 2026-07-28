import { describe, expect, it } from "vitest";
import {
  buildPayoutSplit,
  centsToAmount,
  reconcilePayout,
  toCents,
  type PayoutFigures,
} from "./payout-reconcile";

function figures(over: Partial<PayoutFigures> = {}): PayoutFigures {
  // A clean Stripe month: 5200 gross, 150 refunded, 237.67 in fees.
  return {
    grossSales: 5200,
    refunds: 150,
    fees: 237.67,
    feeTax: null,
    adjustments: null,
    netPayout: 4812.33,
    ...over,
  };
}

describe("toCents", () => {
  it("rounds to integer cents and rejects non-finite values", () => {
    expect(toCents(4812.33)).toBe(481233);
    expect(toCents(0)).toBe(0);
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("survives float noise that would break a naive comparison", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in floating point.
    expect(toCents(0.1)! + toCents(0.2)!).toBe(toCents(0.3));
  });

  it("round-trips through centsToAmount", () => {
    expect(centsToAmount(toCents(1234.56)!)).toBe(1234.56);
  });
});

describe("reconcilePayout", () => {
  it("reconciles a clean payout", () => {
    const r = reconcilePayout(figures());
    expect(r.reconciles).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.differenceCents).toBe(0);
  });

  it("treats absent optional lines as zero, not as unreadable", () => {
    // No refunds, no fees at all: 900 gross in, 900 out.
    const r = reconcilePayout({
      grossSales: 900,
      refunds: null,
      fees: null,
      feeTax: null,
      adjustments: null,
      netPayout: 900,
    });
    expect(r.reconciles).toBe(true);
  });

  it("flags a payout that doesn't add up, with the exact difference", () => {
    // Fees understated by 50.
    const r = reconcilePayout(figures({ fees: 187.67 }));
    expect(r.reconciles).toBe(false);
    expect(r.findings[0].code).toBe("does_not_reconcile");
    expect(r.differenceCents).toBe(-5000);
    expect(r.findings[0].detail_en).toContain("$50.00");
    expect(r.findings[0].detail_fr).toContain("50,00 $");
  });

  it("allows a one-cent rounding drift but not two", () => {
    expect(reconcilePayout(figures({ netPayout: 4812.34 })).reconciles).toBe(true);
    expect(reconcilePayout(figures({ netPayout: 4812.35 })).reconciles).toBe(false);
  });

  it("reports missing figures instead of guessing", () => {
    const r = reconcilePayout(figures({ grossSales: null }));
    expect(r.reconciles).toBe(false);
    expect(r.findings[0].code).toBe("missing_figures");
    expect(r.expectedNetCents).toBeNull();
    expect(r.differenceCents).toBeNull();
  });

  it("never silently reconciles when the gross is unreadable", () => {
    // Both null: must not come out as 0 = 0 "reconciled".
    const r = reconcilePayout({
      grossSales: null,
      refunds: null,
      fees: null,
      feeTax: null,
      adjustments: null,
      netPayout: null,
    });
    expect(r.reconciles).toBe(false);
    expect(r.findings[0].code).toBe("missing_figures");
  });

  it("subtracts fee tax and adjustments when present", () => {
    const r = reconcilePayout({
      grossSales: 1000,
      refunds: 0,
      fees: 30,
      feeTax: 4.5,
      adjustments: 25,
      netPayout: 940.5,
    });
    expect(r.reconciles).toBe(true);
  });

  it("flags a zero or negative payout for a human", () => {
    const r = reconcilePayout({
      grossSales: 100,
      refunds: 130,
      fees: 5,
      feeTax: null,
      adjustments: null,
      netPayout: -35,
    });
    expect(r.findings.map((f) => f.code)).toContain("net_not_positive");
    // The arithmetic still holds, so that's the ONLY finding.
    expect(r.findings.map((f) => f.code)).not.toContain("does_not_reconcile");
  });

  it("every finding carries both languages", () => {
    for (const f of reconcilePayout(figures({ fees: 1 })).findings) {
      expect(f.label_en.length).toBeGreaterThan(0);
      expect(f.label_fr.length).toBeGreaterThan(0);
      expect(f.detail_en.length).toBeGreaterThan(0);
      expect(f.detail_fr.length).toBeGreaterThan(0);
    }
  });
});

describe("buildPayoutSplit", () => {
  it("builds the lines an accountant books, omitting empty ones", () => {
    const lines = buildPayoutSplit(figures());
    expect(lines.map((l) => l.kind)).toEqual([
      "sales",
      "refunds",
      "fees",
      "net",
    ]);
    expect(lines.find((l) => l.kind === "sales")!.amount).toBe(5200);
    expect(lines.find((l) => l.kind === "net")!.amount).toBe(4812.33);
  });

  it("drops zero deduction lines but always keeps the net", () => {
    const lines = buildPayoutSplit({
      grossSales: 900,
      refunds: 0,
      fees: 0,
      feeTax: null,
      adjustments: null,
      netPayout: 0,
    });
    expect(lines.map((l) => l.kind)).toEqual(["sales", "net"]);
    expect(lines.find((l) => l.kind === "net")!.amount).toBe(0);
  });

  it("carries both languages on every line", () => {
    for (const l of buildPayoutSplit(figures())) {
      expect(l.label_en.length).toBeGreaterThan(0);
      expect(l.label_fr.length).toBeGreaterThan(0);
    }
  });
});
