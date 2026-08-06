// What the money adds up to — grouped the way Canopy groups it.
//
// ── WHY THIS IS A PURE MODULE ──────────────────────────────────────────────
//
// The founder, comparing Canopy's Billing and payment screen to ours: "Theres
// no screen or way to view pricing and stuff like fully."
//
// Right, and the readout has to appear in at least three places — the
// engagement's Billing step, the template builder's Services tab, and
// eventually the client's own proposal. Three surfaces computing money three
// times is how a total on one screen stops matching the total on another. So
// the arithmetic lives here, once, with tests, and every surface renders what
// it returns.
//
// ── "TBD" IS A REAL ANSWER, NOT A ZERO ─────────────────────────────────────
//
// Canopy writes "hourly billing determined later" against a group whose rate
// is not fixed, and "TBD" against its tax and total. That is not decoration:
// an unpriced line means the number is genuinely unknown, and rendering it as
// $0.00 would tell a client the work is free. So a group with any unpriced line
// reports `determined: false`, and the caller shows words rather than a figure.
//
// ── TAX IS PER LINE, THEN SUMMED ───────────────────────────────────────────
//
// The same rule the invoice builder already follows. Applying one blended rate
// to a subtotal gives a different (wrong) answer the moment two lines carry
// different tax, which is normal in Canada — a GST-only service beside a
// GST+QST one.

import type { BillingFrequency, EngagementItemDraft } from "@/lib/engagements/items";

/** Canopy's order: one-off first, then shortest cycle to longest. */
export const FREQUENCY_ORDER: BillingFrequency[] = [
  "once",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export type FrequencyTotal = {
  frequency: BillingFrequency;
  /** How many priced or unpriced lines fall in this group. */
  itemCount: number;
  /**
   * FALSE when any line in the group has no rate. The subtotal, tax and total
   * below then describe only the lines that ARE priced, and the caller must say
   * so rather than presenting them as the whole answer.
   */
  determined: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type BillingTotals = {
  /** Only the frequencies actually used, in FREQUENCY_ORDER. */
  groups: FrequencyTotal[];
  /** Every group summed. `determined` is false if ANY group is. */
  determined: boolean;
  subtotalCents: number;
  taxCents: number;
  /**
   * ⚠️ EVERY FREQUENCY ADDED TOGETHER, WHICH IS NOT A PRICE ANYONE PAYS.
   *
   * A $4,000 setup plus $500/month came out as "Engagement total $4,500" — on
   * the client's proposal, with prices visible by default. That is not a total
   * of anything: the two numbers are in different units, one is once and the
   * other is per month forever.
   *
   * Kept because the sum is occasionally useful internally (a rough order-of-
   * magnitude, a sanity check), and REMOVED from every client-facing surface.
   * Show `oneTimeTotalCents` as the headline and let each recurring cycle state
   * itself. Do not put this number in front of a client.
   */
  totalCents: number;
  /**
   * What is actually payable up front — the one-time lines only.
   *
   * This is the "Engagement total" a client can be held to. Recurring cycles
   * are stated separately, in their own units, because "$500/month" is a rate
   * and not an amount.
   */
  oneTimeSubtotalCents: number;
  oneTimeTaxCents: number;
  oneTimeTotalCents: number;
  /** False when a one-time line has no rate, so the headline cannot be stated. */
  oneTimeDetermined: boolean;
  /** What the client pays to make it live. Null when no deposit is required. */
  dueOnAcceptanceCents: number | null;
};

/** Tax on ONE line, rounded to the cent. A null rate is not zero tax on a
 *  priced line — it is "no tax configured", which IS zero. */
function lineTax(rateCents: number, taxPct: number | null): number {
  if (taxPct == null || !Number.isFinite(taxPct) || taxPct <= 0) return 0;
  return Math.round((rateCents * taxPct) / 100);
}

/**
 * Group priced lines by how often they are billed, and total each group.
 *
 * Lines with no name are ignored: the builders keep a blank row on screen for
 * you to type into, and a blank row is not a charge.
 */
export function computeBillingTotals(
  items: readonly EngagementItemDraft[],
  opts: { depositCents?: number | null } = {},
): BillingTotals {
  const named = items.filter((i) => i.name.trim().length > 0);

  const groups: FrequencyTotal[] = [];
  for (const frequency of FREQUENCY_ORDER) {
    const inGroup = named.filter((i) => i.billingFrequency === frequency);
    if (inGroup.length === 0) continue;

    let subtotalCents = 0;
    let taxCents = 0;
    let determined = true;
    for (const item of inGroup) {
      if (item.rateCents == null) {
        // Unpriced. Counted in itemCount so the group still lists it, but the
        // group can no longer claim to know what it comes to.
        determined = false;
        continue;
      }
      subtotalCents += item.rateCents;
      taxCents += lineTax(item.rateCents, item.taxPct);
    }

    groups.push({
      frequency,
      itemCount: inGroup.length,
      determined,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
    });
  }

  const subtotalCents = groups.reduce((n, g) => n + g.subtotalCents, 0);
  const taxCents = groups.reduce((n, g) => n + g.taxCents, 0);

  // The one-time group on its own. This is the number a client can be held to;
  // adding "$500/month" to it produces a figure in no unit at all.
  const once = groups.find((g) => g.frequency === "once");

  const deposit = opts.depositCents;
  return {
    groups,
    oneTimeSubtotalCents: once?.subtotalCents ?? 0,
    oneTimeTaxCents: once?.taxCents ?? 0,
    oneTimeTotalCents: once?.totalCents ?? 0,
    // No one-time lines at all is "determined": the answer is zero up front,
    // which is a real and stateable answer for a purely recurring arrangement.
    oneTimeDetermined: once ? once.determined : true,
    // One unknown anywhere makes the engagement total unknown. Saying "$4,000"
    // when a fourth line is "hourly, TBD" is the misleading answer.
    determined: groups.every((g) => g.determined),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    dueOnAcceptanceCents:
      typeof deposit === "number" && Number.isInteger(deposit) && deposit > 0
        ? deposit
        : null,
  };
}

/** Is there anything at all to show? An empty readout is worse than none. */
export function hasBillingTotals(totals: BillingTotals): boolean {
  return totals.groups.length > 0;
}

/**
 * What "Amount to bill" should say, from the priced lines.
 *
 * Founder: "why do you have to enter an amount to bill twice? ... It should
 * just be automatically calculated based on the service items."
 *
 * Returned as the STRING the money input shows ("11.50"), because that is what
 * the field holds and a caller converting a number back would be a second place
 * for the rounding to be decided.
 *
 * ⚠️ `oneTimeTotalCents`, NOT `totalCents`. See the warning on `totalCents`
 * above: it adds every frequency together and is not a price anyone pays. A
 * $4,000 setup plus $500/month is not a $4,500 invoice.
 *
 * EMPTY STRING when there is nothing it can honestly state — no priced one-time
 * line, or one still missing its rate. Half a total is a wrong number, and a
 * wrong number in a money field is worse than an empty one.
 */
export function invoiceAmountFromTotals(totals: BillingTotals): string {
  if (!totals.oneTimeDetermined) return "";
  if (totals.oneTimeTotalCents <= 0) return "";
  return (totals.oneTimeTotalCents / 100).toFixed(2);
}
