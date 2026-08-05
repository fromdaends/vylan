// Canopy's BILLING BLOCKS — pure rules, no I/O.
//
// ── WHAT A BLOCK IS ────────────────────────────────────────────────────────
//
// A group of services that share one billing rule. Canopy's Services tab is
// built from them: you add a block, say how and when it bills, and put services
// inside it. "$4,000 on acceptance" is one block; "$500/month from the
// engagement start" is another; both can sit on one proposal.
//
// ── WHY THIS IS NOT JUST `item.billingFrequency` ───────────────────────────
//
// Vylan already stores a frequency PER ITEM (migration 1450), and
// groupByFrequency() already gathers them for the totals panel. That was enough
// to answer "what does this client owe and how often" and it is not enough for
// a proposal, because a frequency alone cannot say:
//
//   - WHEN a one-time charge falls due — on acceptance, or on completion
//   - WHEN a recurring charge starts — at the engagement start, or a set date
//   - whether the client sees the lines or only the block's total
//   - what note to show them beside it
//
// Those are properties of the ARRANGEMENT, not of a line. So the block owns the
// rule and the items sit inside it; each item still carries its own rate, and
// on save it inherits the block's frequency, which keeps toInvoiceLineItems and
// the whole invoice path working unchanged.

import {
  hasStatableTotal,
  isMeaningful,
  type BillingFrequency,
  type EngagementItemDraft,
} from "@/lib/engagements/items";

/** One-time, or on a repeating schedule. Canopy's first choice in a block. */
export const BILLING_TYPES = ["one_time", "recurring"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

/**
 * When the charge lands. The options differ by type, which is why this is one
 * union rather than a shared enum — "on completion" is meaningless for a
 * recurring block, and "engagement start" is meaningless for a one-off.
 */
export const ONE_TIME_TIMINGS = ["on_acceptance", "on_completion"] as const;
export const RECURRING_TIMINGS = ["engagement_start", "custom_date"] as const;
export type BlockTiming =
  | (typeof ONE_TIME_TIMINGS)[number]
  | (typeof RECURRING_TIMINGS)[number];

/** The repeat, for a recurring block. `once` is not offered — a block that
 *  bills once is a one-time block, and allowing both would be two ways to say
 *  the same thing that could then disagree. */
export const BLOCK_FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type BlockFrequency = (typeof BLOCK_FREQUENCIES)[number];

export type BillingBlock = {
  billingType: BillingType;
  timing: BlockTiming;
  /** Only read when billingType is "recurring". */
  frequency: BlockFrequency;
  /** Canopy's "Combine items" — show the client one line for the block rather
   *  than each service separately. */
  combineItems: boolean;
  /** A note shown to the client beside this block. */
  clientNote: string;
  items: EngagementItemDraft[];
};

/**
 * Canopy's gear menu: what the client is allowed to see.
 *
 * Three independent switches, not one setting, because they answer different
 * questions and firms genuinely differ. A firm that quotes a single number
 * turns the first two off; one that itemises everything leaves all three on.
 */
export type PriceVisibility = {
  itemizedPrice: boolean;
  blockTotals: boolean;
  total: boolean;
};

export function defaultPriceVisibility(): PriceVisibility {
  // Everything visible. A client who cannot see what they are paying for is the
  // surprising default, not the safe one.
  return { itemizedPrice: true, blockTotals: true, total: true };
}

export function emptyBlock(billingType: BillingType = "one_time"): BillingBlock {
  return {
    billingType,
    timing: billingType === "one_time" ? "on_acceptance" : "engagement_start",
    frequency: "monthly",
    combineItems: false,
    clientNote: "",
    items: [],
  };
}

/**
 * The timings this block may offer.
 *
 * Used by the picker so it can never present a combination the block cannot
 * hold — the same reason `availableKinds` exists for tasks.
 */
export function timingsFor(billingType: BillingType): readonly BlockTiming[] {
  return billingType === "one_time" ? ONE_TIME_TIMINGS : RECURRING_TIMINGS;
}

/**
 * Change a block's type and keep it COHERENT.
 *
 * Switching one-time → recurring leaves the timing pointing at "on_completion",
 * which the new type has no meaning for. Rather than let that sit and be read
 * later as something it is not, the timing resets to the new type's first
 * option. Everything else — the items, the note, the frequency — survives,
 * because none of it becomes wrong.
 */
export function withBillingType(
  block: BillingBlock,
  billingType: BillingType,
): BillingBlock {
  if (block.billingType === billingType) return block;
  return {
    ...block,
    billingType,
    timing: timingsFor(billingType)[0],
  };
}

/** The frequency each item in this block inherits when it is written out. */
export function blockItemFrequency(block: BillingBlock): BillingFrequency {
  return block.billingType === "one_time" ? "once" : block.frequency;
}

export type BlockTotal = {
  /** Cents, tax included, for the lines that can state one. */
  cents: number;
  /** True when at least one line could not be counted (an hourly line with no
   *  rate). The caller must show this — a total that silently omits a line is
   *  a number a client will hold you to. */
  partial: boolean;
  unstatableCount: number;
};

/**
 * What one block comes to.
 *
 * Tax is applied PER LINE and then summed, matching totalForItems and the
 * invoice builder. Summing first and taxing once drifts by a cent or two on
 * mixed rates, and a proposal that disagrees with its own invoice is worse than
 * either being slightly wrong.
 */
export function blockTotal(
  block: BillingBlock,
  fallbackTaxPct: number | null = null,
): BlockTotal {
  let cents = 0;
  let unstatableCount = 0;

  for (const item of block.items) {
    if (!isMeaningful(item)) continue;
    if (!hasStatableTotal(item)) {
      unstatableCount += 1;
      continue;
    }
    const rate = item.rateCents ?? 0;
    const pct = item.taxPct ?? fallbackTaxPct ?? 0;
    cents += rate + Math.round((rate * pct) / 100);
  }

  return { cents, partial: unstatableCount > 0, unstatableCount };
}

/**
 * Is this block worth keeping?
 *
 * A block with no named service is an empty container — it would render as a
 * heading with nothing under it on the client's proposal.
 */
export function blockIsMeaningful(block: BillingBlock): boolean {
  return block.items.some(isMeaningful);
}

/** Drop empty blocks and the blank rows inside the ones that survive. */
export function meaningfulBlocks(
  blocks: readonly BillingBlock[],
): BillingBlock[] {
  return blocks
    .map((b) => ({
      ...b,
      clientNote: b.clientNote.trim(),
      items: b.items.filter(isMeaningful),
    }))
    .filter((b) => b.items.length > 0);
}

/**
 * Every block's items, flattened, each carrying its block's frequency.
 *
 * This is what gets written to `engagement_items` — the blocks are the AUTHORING
 * shape, and the rows underneath stay exactly as they were, so the invoice
 * path, the totals panel and everything else built on 1450 keep working with no
 * knowledge that blocks exist.
 */
export function flattenBlocks(
  blocks: readonly BillingBlock[],
): EngagementItemDraft[] {
  const out: EngagementItemDraft[] = [];
  for (const block of meaningfulBlocks(blocks)) {
    const billingFrequency = blockItemFrequency(block);
    for (const item of block.items) {
      out.push({ ...item, billingFrequency });
    }
  }
  return out;
}
