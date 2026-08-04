// The scope's money arithmetic.
//
// These numbers end up on a proposal a client AGREES to and on the invoice they
// are CHARGED. The two must not disagree, and a total that quietly omits a line
// is worse than no total at all — so most of what is tested here is about what
// happens when a line cannot be priced yet.

import { describe, expect, it } from "vitest";
import {
  emptyItem,
  groupByFrequency,
  hasStatableTotal,
  isMeaningful,
  toInvoiceLineItems,
  totalForItems,
  type EngagementItemDraft,
} from "./items";

function item(over: Partial<EngagementItemDraft> = {}): EngagementItemDraft {
  return { ...emptyItem(), name: "Bookkeeping", rateCents: 125_000, ...over };
}

describe("isMeaningful", () => {
  it("drops a row that was added and never filled in", () => {
    // Otherwise an accidental "+ Add item" click puts a nameless $0 line on the
    // client's proposal.
    expect(isMeaningful(emptyItem())).toBe(false);
    expect(isMeaningful(item({ name: "   " }))).toBe(false);
    expect(isMeaningful(item({ name: "Payroll" }))).toBe(true);
  });

  it("keeps a named line even with no price yet", () => {
    // "We will tell you the rate later" is a real line on a real proposal.
    expect(isMeaningful(item({ rateCents: null }))).toBe(true);
  });
});

describe("hasStatableTotal", () => {
  it("is false for hourly work and for a missing rate", () => {
    expect(hasStatableTotal(item({ rateType: "hour" }))).toBe(false);
    expect(hasStatableTotal(item({ rateCents: null }))).toBe(false);
  });

  it("is true for a fixed amount", () => {
    expect(hasStatableTotal(item({ rateType: "item", rateCents: 1 }))).toBe(true);
  });

  it("counts an explicit zero as statable", () => {
    // $0.00 is a decision ("included at no charge"), not an absence.
    expect(hasStatableTotal(item({ rateCents: 0 }))).toBe(true);
  });
});

describe("totalForItems", () => {
  it("adds up fixed lines", () => {
    const t = totalForItems([
      item({ name: "Bookkeeping", rateCents: 125_000 }),
      item({ name: "Reporting", rateCents: 90_000 }),
    ]);
    expect(t.subtotalCents).toBe(215_000);
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(215_000);
    expect(t.partial).toBe(false);
  });

  it("FLAGS a total that had to leave a line out", () => {
    // The whole point. A total that silently omits the payroll line reads as the
    // whole price, and the client agrees to a number that was never the number.
    const t = totalForItems([
      item({ name: "Bookkeeping", rateCents: 125_000 }),
      item({ name: "Payroll", rateType: "hour", rateCents: 12_500 }),
    ]);
    expect(t.subtotalCents).toBe(125_000);
    expect(t.partial).toBe(true);
    expect(t.unstatableCount).toBe(1);
  });

  it("never treats a missing rate as free", () => {
    const t = totalForItems([item({ name: "TBD", rateCents: null })]);
    expect(t.subtotalCents).toBe(0);
    // Zero AND partial — "nothing countable", not "costs nothing".
    expect(t.partial).toBe(true);
  });

  it("uses each line's own tax rate", () => {
    const t = totalForItems([
      item({ rateCents: 100_000, taxPct: 5 }),
      item({ name: "Other", rateCents: 100_000, taxPct: 13 }),
    ]);
    expect(t.taxCents).toBe(5_000 + 13_000);
  });

  it("falls back to the firm's rate only where a line has none", () => {
    const t = totalForItems(
      [
        item({ rateCents: 100_000, taxPct: null }),
        item({ name: "Other", rateCents: 100_000, taxPct: 0 }),
      ],
      13,
    );
    // The second line says 0 EXPLICITLY, which is not the same as "unset" and
    // must not pick up the firm default.
    expect(t.taxCents).toBe(13_000);
  });

  it("leaves lines untaxed when there is no rate anywhere", () => {
    const t = totalForItems([item({ rateCents: 100_000, taxPct: null })], null);
    expect(t.taxCents).toBe(0);
  });

  it("rounds tax per line, matching the invoice", () => {
    // 333 cents at 13% is 43.29 → 43. Two such lines are 86, not 87 (which is
    // what rounding the summed 86.58 would give). A proposal that disagrees
    // with its own invoice by a cent is worse than one that is approximate.
    const t = totalForItems([
      item({ rateCents: 333, taxPct: 13 }),
      item({ name: "Other", rateCents: 333, taxPct: 13 }),
    ]);
    expect(t.taxCents).toBe(86);
  });

  it("ignores rows that were never filled in", () => {
    const t = totalForItems([item({ rateCents: 50_000 }), emptyItem()]);
    expect(t.subtotalCents).toBe(50_000);
    // An empty row is not an unpriced line — it is not a line at all.
    expect(t.partial).toBe(false);
  });

  it("returns a clean zero for no items", () => {
    expect(totalForItems([])).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      partial: false,
      unstatableCount: 0,
    });
  });
});

describe("groupByFrequency", () => {
  it("groups in a fixed order and drops empty groups", () => {
    const groups = groupByFrequency([
      item({ name: "Payroll", billingFrequency: "weekly" }),
      item({ name: "Bookkeeping", billingFrequency: "monthly" }),
      item({ name: "Reporting", billingFrequency: "monthly" }),
    ]);
    expect(groups.map((g) => g.frequency)).toEqual(["weekly", "monthly"]);
    expect(groups[1].items.map((i) => i.name)).toEqual([
      "Bookkeeping",
      "Reporting",
    ]);
  });

  it("leaves out rows that were never filled in", () => {
    expect(groupByFrequency([emptyItem()])).toEqual([]);
  });
});

describe("toInvoiceLineItems", () => {
  it("produces the shape payment_requests.line_items already uses", () => {
    // The founder's constraint made concrete: the engagement's price is not a
    // second billing system beside the invoice, it is what the invoice is built
    // from.
    expect(toInvoiceLineItems([item({ name: "Bookkeeping", rateCents: 125_000 })])).toEqual(
      [
        {
          description: "Bookkeeping",
          quantity: 1,
          unit_cents: 125_000,
          amount_cents: 125_000,
        },
      ],
    );
  });

  it("omits lines that have no amount to bill yet", () => {
    // Inventing an amount for an hourly line charges the client a number nobody
    // agreed to.
    const lines = toInvoiceLineItems([
      item({ name: "Bookkeeping", rateCents: 125_000 }),
      item({ name: "Payroll", rateType: "hour", rateCents: 12_500 }),
      item({ name: "TBD", rateCents: null }),
    ]);
    expect(lines.map((l) => l.description)).toEqual(["Bookkeeping"]);
  });

  it("trims the name it puts on the invoice", () => {
    expect(toInvoiceLineItems([item({ name: "  Bookkeeping  " })])[0].description).toBe(
      "Bookkeeping",
    );
  });
});
