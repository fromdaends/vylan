import { describe, it, expect } from "vitest";
import {
  computeBillingTotals,
  hasBillingTotals,
  FREQUENCY_ORDER,
  invoiceAmountFromTotals,
  type BillingTotals,
} from "./billing-totals";
import type { EngagementItemDraft } from "./items";

const item = (over: Partial<EngagementItemDraft> = {}): EngagementItemDraft => ({
  name: "Bookkeeping",
  serviceId: null,
  description: null,
  rateCents: 100_00,
  rateType: "item",
  billingFrequency: "monthly",
  taxPct: null,
  ...over,
});

describe("computeBillingTotals — grouping", () => {
  it("shows nothing for an empty list", () => {
    const t = computeBillingTotals([]);
    expect(t.groups).toEqual([]);
    expect(hasBillingTotals(t)).toBe(false);
  });

  it("ignores blank rows — a row you are about to type into is not a charge", () => {
    const t = computeBillingTotals([item({ name: "   " })]);
    expect(t.groups).toEqual([]);
  });

  it("groups by billing frequency and skips the ones nobody used", () => {
    const t = computeBillingTotals([
      item({ billingFrequency: "monthly" }),
      item({ billingFrequency: "monthly" }),
      item({ billingFrequency: "yearly" }),
    ]);
    expect(t.groups.map((g) => g.frequency)).toEqual(["monthly", "yearly"]);
    expect(t.groups[0].itemCount).toBe(2);
  });

  it("orders groups one-off first, then shortest cycle to longest", () => {
    const t = computeBillingTotals(
      // Deliberately reversed on the way in.
      [...FREQUENCY_ORDER].reverse().map((f) => item({ billingFrequency: f })),
    );
    expect(t.groups.map((g) => g.frequency)).toEqual(FREQUENCY_ORDER);
  });
});

describe("computeBillingTotals — money", () => {
  it("adds up a simple group", () => {
    const t = computeBillingTotals([
      item({ rateCents: 40_000 }),
      item({ rateCents: 25_50 }),
    ]);
    expect(t.subtotalCents).toBe(42_550);
    expect(t.totalCents).toBe(42_550);
  });

  it("taxes each line then sums — NOT one rate over the subtotal", () => {
    // A GST-only line beside a GST+QST one is ordinary in Canada, and a blended
    // rate over the subtotal gives a different (wrong) answer.
    const t = computeBillingTotals([
      item({ rateCents: 100_00, taxPct: 5 }),
      item({ rateCents: 100_00, taxPct: 14.975 }),
    ]);
    expect(t.subtotalCents).toBe(200_00);
    expect(t.taxCents).toBe(500 + 1498); // 5.00 + 14.98, each rounded alone
    expect(t.totalCents).toBe(200_00 + 500 + 1498);
  });

  it("treats a missing tax rate as no tax, not as an unknown", () => {
    const t = computeBillingTotals([item({ rateCents: 100_00, taxPct: null })]);
    expect(t.taxCents).toBe(0);
    expect(t.determined).toBe(true);
  });

  it("a zero or negative tax rate adds nothing", () => {
    expect(
      computeBillingTotals([item({ rateCents: 100_00, taxPct: 0 })]).taxCents,
    ).toBe(0);
    expect(
      computeBillingTotals([item({ rateCents: 100_00, taxPct: -5 })]).taxCents,
    ).toBe(0);
  });
});

describe("computeBillingTotals — an unpriced line is UNKNOWN, never zero", () => {
  it("marks its own group undetermined", () => {
    const t = computeBillingTotals([
      item({ rateCents: null, name: "Advisory (hourly)" }),
    ]);
    expect(t.groups[0].determined).toBe(false);
    // Rendering this as $0.00 would tell a client the work is free.
    expect(t.groups[0].subtotalCents).toBe(0);
  });

  it("still counts the line, so the group lists it", () => {
    const t = computeBillingTotals([
      item({ rateCents: 40_000 }),
      item({ rateCents: null }),
    ]);
    expect(t.groups[0].itemCount).toBe(2);
    expect(t.groups[0].subtotalCents).toBe(40_000);
    expect(t.groups[0].determined).toBe(false);
  });

  it("one unknown anywhere makes the ENGAGEMENT total unknown", () => {
    // "$4,000" beside a fourth line reading "hourly, TBD" is the misleading
    // answer, so the whole readout admits it does not know.
    const t = computeBillingTotals([
      item({ rateCents: 400_000, billingFrequency: "monthly" }),
      item({ rateCents: null, billingFrequency: "weekly" }),
    ]);
    expect(t.groups.find((g) => g.frequency === "monthly")!.determined).toBe(true);
    expect(t.determined).toBe(false);
  });

  it("everything priced means the total is trustworthy", () => {
    const t = computeBillingTotals([
      item({ rateCents: 100_00, billingFrequency: "monthly" }),
      item({ rateCents: 200_00, billingFrequency: "yearly" }),
    ]);
    expect(t.determined).toBe(true);
    expect(t.totalCents).toBe(300_00);
  });
});

describe("computeBillingTotals — due on acceptance", () => {
  it("is null when no deposit is required", () => {
    expect(computeBillingTotals([item()]).dueOnAcceptanceCents).toBeNull();
    expect(
      computeBillingTotals([item()], { depositCents: null }).dueOnAcceptanceCents,
    ).toBeNull();
  });

  it("refuses a zero, fractional or negative deposit", () => {
    for (const depositCents of [0, -100, 10.5]) {
      expect(
        computeBillingTotals([item()], { depositCents }).dueOnAcceptanceCents,
      ).toBeNull();
    }
  });

  it("carries a real deposit through", () => {
    expect(
      computeBillingTotals([item()], { depositCents: 100_000 })
        .dueOnAcceptanceCents,
    ).toBe(100_000);
  });

  it("is independent of whether the rest is priced", () => {
    // You can know the deposit and not yet know the engagement total.
    const t = computeBillingTotals([item({ rateCents: null })], {
      depositCents: 50_000,
    });
    expect(t.determined).toBe(false);
    expect(t.dueOnAcceptanceCents).toBe(50_000);
  });
});

describe("the headline total is the ONE-TIME money only", () => {
  it("does not add a monthly rate into the engagement total", () => {
    // A $4,000 setup plus $500/month printed "Engagement total $4,500" on the
    // client's proposal. That is not a total of anything — one number is once
    // and the other is per month forever.
    const totals = computeBillingTotals([
      item({ name: "Setup", rateCents: 400_000, billingFrequency: "once", taxPct: 0 }),
      item({ name: "Bookkeeping", rateCents: 50_000, billingFrequency: "monthly", taxPct: 0 }),
    ]);
    expect(totals.oneTimeTotalCents).toBe(400_000);
    expect(totals.oneTimeDetermined).toBe(true);
    // The old cross-frequency sum still exists for internal use, and is still
    // the misleading number — which is exactly why nothing client-facing shows
    // it any more.
    expect(totals.totalCents).toBe(450_000);
  });

  it("reads $0 up front for a purely recurring arrangement", () => {
    // "Nothing due up front" is a real, stateable answer — not unknown.
    const totals = computeBillingTotals([
      item({ name: "Bookkeeping", rateCents: 50_000, billingFrequency: "monthly", taxPct: 0 }),
    ]);
    expect(totals.oneTimeTotalCents).toBe(0);
    expect(totals.oneTimeDetermined).toBe(true);
  });

  it("carries tax on the one-time lines into the headline", () => {
    const totals = computeBillingTotals([
      item({ name: "Setup", rateCents: 100_000, billingFrequency: "once", taxPct: 10 }),
      item({ name: "Monthly", rateCents: 50_000, billingFrequency: "monthly", taxPct: 10 }),
    ]);
    expect(totals.oneTimeSubtotalCents).toBe(100_000);
    expect(totals.oneTimeTaxCents).toBe(10_000);
    expect(totals.oneTimeTotalCents).toBe(110_000);
  });

  it("is UNDETERMINED when a one-time line has no rate", () => {
    const totals = computeBillingTotals([
      item({ name: "Setup", rateCents: 400_000, billingFrequency: "once", taxPct: 0 }),
      item({ name: "Advisory", rateCents: null, billingFrequency: "once", taxPct: 0 }),
    ]);
    expect(totals.oneTimeDetermined).toBe(false);
  });

  it("stays determined when only a RECURRING line is unpriced", () => {
    // An unknown monthly rate does not make the up-front figure unknown.
    const totals = computeBillingTotals([
      item({ name: "Setup", rateCents: 400_000, billingFrequency: "once", taxPct: 0 }),
      item({ name: "Advisory", rateCents: null, billingFrequency: "monthly", taxPct: 0 }),
    ]);
    expect(totals.oneTimeDetermined).toBe(true);
    expect(totals.oneTimeTotalCents).toBe(400_000);
    // The cross-frequency `determined` is still false, correctly.
    expect(totals.determined).toBe(false);
  });
});

describe("invoiceAmountFromTotals — what Amount to bill fills itself with", () => {
  const totals = (over: Partial<BillingTotals>): BillingTotals =>
    ({
      groups: [],
      determined: true,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      oneTimeSubtotalCents: 0,
      oneTimeTaxCents: 0,
      oneTimeTotalCents: 0,
      oneTimeDetermined: true,
      dueOnAcceptanceCents: null,
      ...over,
    }) as BillingTotals;

  it("gives the one-time total, tax included, as the input's string", () => {
    expect(
      invoiceAmountFromTotals(totals({ oneTimeTotalCents: 1150 })),
    ).toBe("11.50");
    expect(
      invoiceAmountFromTotals(totals({ oneTimeTotalCents: 400_000 })),
    ).toBe("4000.00");
  });

  it("⚠️ ignores totalCents, which is not a price anyone pays", () => {
    // $4,000 once + $500/month. The invoice is 4000, never 4500.
    expect(
      invoiceAmountFromTotals(
        totals({ oneTimeTotalCents: 400_000, totalCents: 450_000 }),
      ),
    ).toBe("4000.00");
  });

  it("says nothing rather than half a total", () => {
    // A one-time line with no rate yet. Filling in the part we know would put a
    // number in a money field that no line adds up to.
    expect(
      invoiceAmountFromTotals(
        totals({ oneTimeTotalCents: 1000, oneTimeDetermined: false }),
      ),
    ).toBe("");
  });

  it("says nothing when there is nothing billed up front", () => {
    // Purely recurring work: the invoice is raised each period by the
    // recurring-charge job, not once here.
    expect(invoiceAmountFromTotals(totals({ oneTimeTotalCents: 0 }))).toBe("");
  });
});
