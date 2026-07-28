import { describe, expect, it } from "vitest";
import { payoutCardData } from "./payout-breakdown-card";

const stored = {
  payout: {
    extraction: {
      processor: "Stripe",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      currency: "CAD",
      grossSales: 5200,
      refunds: 150,
      fees: 237.67,
      feeTax: null,
      adjustments: null,
      netPayout: 4812.33,
      note: "",
    },
    reconciliation: { reconciles: true, findings: [] },
  },
};

describe("payoutCardData", () => {
  it("reads a stored payout into card props", () => {
    const d = payoutCardData(stored);
    expect(d).not.toBeNull();
    expect(d!.processor).toBe("Stripe");
    expect(d!.figures.grossSales).toBe(5200);
    expect(d!.figures.netPayout).toBe(4812.33);
    expect(d!.reconciles).toBe(true);
  });

  it("returns null for documents with no payout block", () => {
    expect(payoutCardData(null)).toBeNull();
    expect(payoutCardData({})).toBeNull();
    expect(payoutCardData({ transaction: { total: 12 } })).toBeNull();
    // Legacy rows written before the feature.
    expect(payoutCardData({ extracted_year: 2024 })).toBeNull();
  });

  it("returns null when neither end of the split was legible", () => {
    const blind = {
      payout: {
        extraction: { grossSales: null, netPayout: null },
        reconciliation: { reconciles: false, findings: [] },
      },
    };
    expect(payoutCardData(blind)).toBeNull();
  });

  it("renders from a partial read (net known, gross not)", () => {
    const partial = {
      payout: {
        extraction: { grossSales: null, netPayout: 900 },
        reconciliation: {
          reconciles: false,
          findings: [
            {
              code: "missing_figures",
              label_en: "x",
              label_fr: "x",
              detail_en: "y",
              detail_fr: "y",
            },
          ],
        },
      },
    };
    const d = payoutCardData(partial);
    expect(d!.figures.netPayout).toBe(900);
    expect(d!.reconciles).toBe(false);
    expect(d!.findings).toHaveLength(1);
  });

  it("never claims reconciled unless the stored flag is exactly true", () => {
    const fuzzy = {
      payout: {
        extraction: { grossSales: 10, netPayout: 10 },
        reconciliation: { reconciles: "yes", findings: null },
      },
    };
    const d = payoutCardData(fuzzy);
    expect(d!.reconciles).toBe(false);
    expect(d!.findings).toEqual([]);
  });

  it("tolerates junk in the stored shape", () => {
    expect(payoutCardData({ payout: "nope" })).toBeNull();
    expect(payoutCardData({ payout: { extraction: 5 } })).toBeNull();
    const d = payoutCardData({
      payout: {
        extraction: { grossSales: "lots", netPayout: 42, processor: 7 },
      },
    });
    expect(d!.figures.grossSales).toBeNull();
    expect(d!.processor).toBeNull();
  });
});
