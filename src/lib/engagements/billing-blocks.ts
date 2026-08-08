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
//   - whether the client sees the lines or only the block's total
//   - what note to show them beside it
//
// Those are properties of the ARRANGEMENT, not of a line. So the block owns the
// rule and the items sit inside it; each item still carries its own rate, and
// on save it inherits the block's frequency, which keeps toInvoiceLineItems and
// the whole invoice path working unchanged.
//
// ── A BLOCK NO LONGER SAYS *WHEN* THE MONEY IS TAKEN ───────────────────────
//
// It used to. A block carried a `timing` — on acceptance / on completion /
// engagement start / a date — and flattenBlocks wrote it onto every line.
//
// Founder: "You cannot decide a time when it's paid on service items. That just
// does not happen. It cannot happen. Only have it be in billing and payments,
// and if the automation does it, then it's in the automation section. It's one
// or the other."
//
// They were describing a real fault, and they were more right than the code
// looked. Two things were wrong at once:
//
// 1. THE QUESTION WAS ASKED TWICE. The engagement's Billing and payments step
//    already answers it, in an overlapping vocabulary — `invoice_auto_mode` is
//    off / on_acceptance / on_completion / delayed. Two controls, half the
//    words identical, different scopes, nothing on screen saying which wins.
//
// 2. THE PICKER NEVER WROTE ANYTHING. 1740 added the column, taught this file
//    to carry the block's timing down onto each line, and taught the insert in
//    db/engagements.ts to persist it — but the engagement builder's payload
//    mapper, the ONLY producer of `service_items` in the app, never included
//    the field. So `it.billing_timing` was always undefined, the conditional
//    spread never fired, and no engagement_items row has ever had a timing.
//    No migration backfilled one either. acceptance-lines' query has therefore
//    always matched exactly zero rows.
//
// Which means the founder's "I don't think it does anything" was literally
// true: they picked an option, nothing happened, and the fix for that is to
// remove the control rather than to finish wiring a second answer.
//
// The timing is GONE from the authoring shape — not hidden, absent, so no
// screen can offer it and no save can invent one. Lines go out with
// billingTiming NULL, which is not a new state: it is the documented pre-1740
// default and already means "the firm's invoice settings decide" (see
// EngagementItem.billingTiming). One question, one place.
//
// The READERS are left alone (acceptance-lines, start-schedules). They match
// nothing today and handle NULL correctly, so they are harmless; unpicking them
// means touching the acceptance and invoice paths, which is real money and a
// separate job from removing a control that never worked.

import {
  hasStatableTotal,
  isMeaningful,
  type BillingFrequency,
  type EngagementItemDraft,
} from "@/lib/engagements/items";

/** One-time, or on a repeating schedule. Canopy's first choice in a block. */
export const BILLING_TYPES = ["one_time", "recurring"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

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
    frequency: "monthly",
    combineItems: false,
    clientNote: "",
    items: [],
  };
}

/**
 * Change a block's type.
 *
 * This used to exist to keep a block COHERENT: switching one-time → recurring
 * left the timing pointing at "on_completion", which the new type had no
 * meaning for, so the timing was reset. With the timing gone there is nothing
 * left to become wrong — the items, the note and the frequency all survive any
 * switch — so this is now a plain setter. It is kept as a function because the
 * template builder's type pills call it, and because a block growing another
 * type-dependent field later should have one place to handle that.
 */
export function withBillingType(
  block: BillingBlock,
  billingType: BillingType,
): BillingBlock {
  if (block.billingType === billingType) return block;
  return { ...block, billingType };
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
      out.push({
        ...item,
        billingFrequency,
        // ── NO TIMING IS WRITTEN, ON PURPOSE (1820) ────────────────────────
        //
        // 1740 made the block's `timing` ride along here beside the frequency.
        // The block no longer has one — see the header — so every line now goes
        // out with these NULL, and the engagement's Billing and payments step
        // is the only thing that decides when money is taken.
        //
        // Set explicitly rather than omitted. `item` is spread above and a
        // draft reconstructed from an older engagement can still be carrying a
        // timing; letting that survive the flatten would put back the invisible
        // second answer this removed.
        billingTiming: null,
        billingStartDate: null,
      });
    }
  }
  return out;
}
