import { describe, it, expect } from "vitest";
import {
  emptyBlock,
  timingsFor,
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
  it("starts one-time, due on acceptance", () => {
    const b = emptyBlock();
    expect(b.billingType).toBe("one_time");
    expect(b.timing).toBe("on_acceptance");
  });

  it("starts a recurring block at the engagement start", () => {
    expect(emptyBlock("recurring").timing).toBe("engagement_start");
  });
});

describe("timingsFor", () => {
  it("offers only the timings that mean something for the type", () => {
    expect(timingsFor("one_time")).toEqual(["on_acceptance", "on_completion"]);
    expect(timingsFor("recurring")).toEqual([
      "engagement_start",
      "custom_date",
    ]);
  });

  it("never offers a completion timing to a recurring block", () => {
    expect(timingsFor("recurring")).not.toContain("on_completion");
  });
});

describe("withBillingType", () => {
  it("resets a timing the new type has no meaning for", () => {
    const b = block({ billingType: "one_time", timing: "on_completion" });
    expect(withBillingType(b, "recurring").timing).toBe("engagement_start");
  });

  it("keeps the items, the note and the frequency", () => {
    const b = block({
      timing: "on_completion",
      clientNote: "Paid on filing",
      frequency: "quarterly",
      items: [item()],
    });
    const next = withBillingType(b, "recurring");
    expect(next.items).toHaveLength(1);
    expect(next.clientNote).toBe("Paid on filing");
    expect(next.frequency).toBe("quarterly");
  });

  it("is a no-op when the type has not changed", () => {
    const b = block({ billingType: "one_time", timing: "on_completion" });
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
      block({ items: [item({ rateCents: 4200, rateType: "hour", taxPct: 5 })] }),
    ]);
    expect(out[0].rateCents).toBe(4200);
    expect(out[0].rateType).toBe("hour");
    expect(out[0].taxPct).toBe(5);
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
