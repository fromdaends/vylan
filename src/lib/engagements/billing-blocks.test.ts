import { describe, it, expect } from "vitest";
import {
  emptyBlock,
  withBillingType,
  blockItemFrequency,
  blockTotal,
  blockIsMeaningful,
  meaningfulBlocks,
  flattenBlocks,
  defaultPriceVisibility,
  type BillingBlock,
} from "./billing-blocks";
import { emptyItem, type EngagementItemDraft } from "./items";

const item = (over: Partial<EngagementItemDraft> = {}): EngagementItemDraft => ({
  ...emptyItem(),
  name: "Bookkeeping",
  rateCents: 100_00,
  rateType: "item",
  ...over,
});

const block = (over: Partial<BillingBlock> = {}): BillingBlock => ({
  ...emptyBlock(),
  ...over,
});

describe("emptyBlock", () => {
  it("starts one-time", () => {
    expect(emptyBlock().billingType).toBe("one_time");
  });

  // A block used to be born saying WHEN it billed, and one-time blocks were
  // born saying "on acceptance". The engagement's Billing and payments step is
  // the only thing that answers that now, so the shape cannot carry it at all —
  // this asserts the absence, because a field silently reappearing here is
  // exactly how the second answer would come back.
  it("carries no billing timing at all", () => {
    expect(emptyBlock()).not.toHaveProperty("timing");
    expect(emptyBlock("recurring")).not.toHaveProperty("timing");
    expect(emptyBlock()).not.toHaveProperty("startDate");
  });
});

describe("withBillingType", () => {
  it("keeps the items, the note and the frequency", () => {
    const b = block({
      clientNote: "Paid on filing",
      frequency: "quarterly",
      items: [item()],
    });
    const next = withBillingType(b, "recurring");
    expect(next.billingType).toBe("recurring");
    expect(next.items).toHaveLength(1);
    expect(next.clientNote).toBe("Paid on filing");
    expect(next.frequency).toBe("quarterly");
  });

  it("is a no-op when the type has not changed", () => {
    const b = block({ billingType: "one_time" });
    expect(withBillingType(b, "one_time")).toBe(b);
  });
});

describe("blockItemFrequency", () => {
  it("is 'once' for a one-time block whatever its frequency field says", () => {
    // The field is only read for a recurring block; a stale value must not leak.
    const b = block({ billingType: "one_time", frequency: "yearly" });
    expect(blockItemFrequency(b)).toBe("once");
  });

  it("is the block's frequency when recurring", () => {
    const b = block({ billingType: "recurring", frequency: "quarterly" });
    expect(blockItemFrequency(b)).toBe("quarterly");
  });
});

describe("blockTotal", () => {
  it("sums the lines", () => {
    const b = block({ items: [item({ rateCents: 100_00 }), item({ rateCents: 50_00 })] });
    expect(blockTotal(b).cents).toBe(150_00);
    expect(blockTotal(b).partial).toBe(false);
  });

  it("applies tax PER LINE, then sums", () => {
    // 3 lines at 33 cents with 5% tax: per-line rounding gives 3 x (33 + 2).
    const b = block({
      items: [
        item({ rateCents: 33, taxPct: 5 }),
        item({ rateCents: 33, taxPct: 5 }),
        item({ rateCents: 33, taxPct: 5 }),
      ],
    });
    expect(blockTotal(b).cents).toBe(3 * (33 + Math.round((33 * 5) / 100)));
  });

  it("uses the fallback tax rate only where a line sets none", () => {
    const b = block({
      items: [item({ rateCents: 100_00, taxPct: null }), item({ rateCents: 100_00, taxPct: 0 })],
    });
    // First takes the 10% fallback; second states 0 and keeps it.
    expect(blockTotal(b, 10).cents).toBe(110_00 + 100_00);
  });

  it("reports partial rather than silently omitting an hourly line with no rate", () => {
    const b = block({
      items: [
        item({ rateCents: 100_00 }),
        item({ name: "Advice", rateCents: null, rateType: "hour" }),
      ],
    });
    const t = blockTotal(b);
    expect(t.cents).toBe(100_00);
    expect(t.partial).toBe(true);
    expect(t.unstatableCount).toBe(1);
  });

  it("ignores blank rows entirely", () => {
    const b = block({ items: [item(), { ...emptyItem(), name: "  " }] });
    expect(blockTotal(b).cents).toBe(100_00);
    expect(blockTotal(b).partial).toBe(false);
  });

  it("an empty block is zero and NOT partial", () => {
    const t = blockTotal(block());
    expect(t.cents).toBe(0);
    expect(t.partial).toBe(false);
  });
});

describe("blockIsMeaningful / meaningfulBlocks", () => {
  it("a block with no named service is not worth keeping", () => {
    expect(blockIsMeaningful(block({ items: [{ ...emptyItem(), name: " " }] }))).toBe(
      false,
    );
  });

  it("drops empty blocks and the blank rows inside survivors", () => {
    const out = meaningfulBlocks([
      block({ items: [item(), { ...emptyItem(), name: "" }] }),
      block({ items: [] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].items).toHaveLength(1);
  });

  it("trims the client note", () => {
    const out = meaningfulBlocks([block({ clientNote: "  note  ", items: [item()] })]);
    expect(out[0].clientNote).toBe("note");
  });

  it("does not mutate the blocks it was given", () => {
    const blocks = [block({ items: [item(), { ...emptyItem(), name: "" }] })];
    meaningfulBlocks(blocks);
    expect(blocks[0].items).toHaveLength(2);
  });
});

describe("flattenBlocks", () => {
  it("gives every item its block's frequency", () => {
    const out = flattenBlocks([
      block({ billingType: "one_time", items: [item({ name: "Setup" })] }),
      block({
        billingType: "recurring",
        frequency: "monthly",
        items: [item({ name: "Bookkeeping" })],
      }),
    ]);
    expect(out.map((i) => [i.name, i.billingFrequency])).toEqual([
      ["Setup", "once"],
      ["Bookkeeping", "monthly"],
    ]);
  });

  it("OVERRIDES a stale frequency the item was carrying", () => {
    // The block decides. An item that remembers an older answer must not win.
    const out = flattenBlocks([
      block({
        billingType: "recurring",
        frequency: "quarterly",
        items: [item({ billingFrequency: "yearly" })],
      }),
    ]);
    expect(out[0].billingFrequency).toBe("quarterly");
  });

  it("drops empty blocks and blank rows", () => {
    const out = flattenBlocks([
      block({ items: [item(), { ...emptyItem(), name: "" }] }),
      block({ items: [] }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps everything else about the item", () => {
    const out = flattenBlocks([
      block({
        items: [
          item({ rateCents: 4200, rateType: "hour", taxPct: 5, budgetMinutes: 120 }),
        ],
      }),
    ]);
    expect(out[0].rateCents).toBe(4200);
    expect(out[0].rateType).toBe("hour");
    expect(out[0].taxPct).toBe(5);
    // The line's own hours (1820) survive the flatten — without this the
    // capacity board never sees them.
    expect(out[0].budgetMinutes).toBe(120);
  });

  it("writes NO billing timing, even when the item was carrying one", () => {
    // The item is spread into the output, so a draft reconstructed from an
    // older engagement could smuggle a timing back through. It must not: the
    // engagement's Billing and payments step is the only answer now, and NULL
    // is what every reader already treats as "the firm's settings decide".
    const out = flattenBlocks([
      block({
        items: [
          item({
            billingTiming: "on_acceptance",
            billingStartDate: "2026-03-01",
          }),
        ],
      }),
    ]);
    expect(out[0].billingTiming).toBeNull();
    expect(out[0].billingStartDate).toBeNull();
  });

  it("is empty for no blocks at all", () => {
    expect(flattenBlocks([])).toEqual([]);
  });
});

describe("defaultPriceVisibility", () => {
  it("shows the client everything — hiding prices is the surprising default", () => {
    expect(defaultPriceVisibility()).toEqual({
      itemizedPrice: true,
      blockTotals: true,
      total: true,
    });
  });
});
