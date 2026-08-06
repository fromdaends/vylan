// Priced service lines on an engagement — the scope.
//
// This module is deliberately PURE: shapes, validation and money arithmetic, no
// Supabase. The totals below end up on a proposal a client agrees to and on the
// invoice they are charged, so they need to be testable without a database.
//
// The founder's framing, comparing Vylan against Canopy: "an engagement is not
// purely defined by document requested checklist items. Its abundant amount of
// tasks and things to do." These rows are the spine of that — the invoice is
// generated from them, and tasks hang off them.

/** How a rate is read. */
export type RateType = "item" | "hour";

/** How often an item is billed. */
export type BillingFrequency =
  | "once"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export const RATE_TYPES: readonly RateType[] = ["item", "hour"] as const;
export const BILLING_FREQUENCIES: readonly BillingFrequency[] = [
  "once",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type EngagementItem = {
  id: string;
  /** What the client reads on the proposal, e.g. "Monthly Bookkeeping". */
  name: string;
  /**
   * Which catalogue entry this line came from (migration 1480).
   *
   * PROVENANCE ONLY — the line keeps its own copied name and price and never
   * reads through. Canopy holds the same line: their folder templates say
   * "Edited folder templates do not update any pre-existing folder templates
   * that are already applied", and the reason is the same one that matters
   * here — editing the catalogue must not rewrite a proposal a client has
   * already agreed to.
   *
   * NULL = a bespoke line, which is the ordinary case for one-off work.
   */
  serviceId: string | null;
  description: string | null;
  /**
   * Integer cents, or NULL for "not fixed yet".
   *
   * NULL is a real answer, not missing data — an hourly line whose total nobody
   * can know up front. It must never be coerced to 0: a proposal that says $0.00
   * where it means "we will tell you" has promised the work for free.
   */
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  /** Percentage (13 = 13%), or null to fall back to the firm's default. */
  taxPct: number | null;
  /**
   * WHEN this line bills, inherited from its billing block (1740).
   *
   * Its frequency says how OFTEN; this says when it STARTS or falls due — and
   * without it "$4,000 due on acceptance" was a label with nothing behind it.
   *
   * NULL is the pre-1740 default and must stay meaningful: a one-time line
   * bills when the firm's invoice settings say, and a recurring one starts at
   * the engagement start. Every line written before this existed reads that way.
   */
  billingTiming?: BillingTiming | null;
  /** Only read when billingTiming is 'custom_date'. ISO date. */
  billingStartDate?: string | null;
};

/**
 * When a line falls due. Mirrors billing-blocks.ts's BlockTiming exactly — the
 * block chooses it and every line inside inherits it, the same way frequency
 * already works.
 */
export const BILLING_TIMINGS = [
  "on_acceptance",
  "on_completion",
  "engagement_start",
  "custom_date",
] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

export function isBillingTiming(v: unknown): v is BillingTiming {
  return (
    typeof v === "string" &&
    (BILLING_TIMINGS as readonly string[]).includes(v)
  );
}

/** A draft row in the builder, before it has been saved and given an id. */
export type EngagementItemDraft = Omit<EngagementItem, "id"> & { id?: string };

export function emptyItem(): EngagementItemDraft {
  return {
    name: "",
    serviceId: null,
    description: null,
    rateCents: null,
    rateType: "item",
    billingFrequency: "once",
    taxPct: null,
  };
}

/**
 * Is this line worth saving? A row the accountant added and never filled in
 * should be dropped silently rather than saved as a nameless $0 line that then
 * appears on the client's proposal.
 */
export function isMeaningful(item: EngagementItemDraft): boolean {
  return item.name.trim().length > 0;
}

/**
 * Can this line's contribution to a total be stated at all?
 *
 * An hourly line has no knowable period total (nobody knows the hours yet), and
 * a line with no rate has none either. Both are legitimate — they just cannot be
 * added up, which is why totals below are "partial" rather than wrong.
 */
export function hasStatableTotal(item: EngagementItemDraft): boolean {
  return item.rateType === "item" && item.rateCents != null;
}

export type ItemsTotal = {
  /** Sum of every line that CAN be stated, in cents, before tax. */
  subtotalCents: number;
  /** Tax on those lines, using each line's own rate (or the fallback). */
  taxCents: number;
  totalCents: number;
  /**
   * True when at least one line could not be counted — hourly, or no rate yet.
   *
   * The UI must say so. A total that silently omits the payroll line reads as
   * the whole price, and the client agrees to a number that was never the whole
   * number. Canopy shows exactly this as "hourly billing determined later".
   */
  partial: boolean;
  /** How many lines were left out of the total. */
  unstatableCount: number;
};

/**
 * Add up the lines that can be added up.
 *
 * `fallbackTaxPct` is the firm's default, used for any line whose own taxPct is
 * null. Pass null when the firm has no default — then those lines are untaxed
 * rather than taxed at a guessed rate.
 */
export function totalForItems(
  items: EngagementItemDraft[],
  fallbackTaxPct: number | null = null,
): ItemsTotal {
  let subtotalCents = 0;
  let taxCents = 0;
  let unstatableCount = 0;

  for (const item of items) {
    if (!isMeaningful(item)) continue;
    if (!hasStatableTotal(item)) {
      unstatableCount += 1;
      continue;
    }
    const cents = item.rateCents ?? 0;
    subtotalCents += cents;
    const pct = item.taxPct ?? fallbackTaxPct;
    if (pct != null && pct > 0) {
      // Rounded PER LINE, then summed — the same order the invoice builder uses.
      // Rounding the summed tax instead can differ by a cent from the invoice
      // the client is eventually charged, and a proposal that disagrees with its
      // own invoice is worse than one that is merely approximate.
      taxCents += Math.round((cents * pct) / 100);
    }
  }

  return {
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    partial: unstatableCount > 0,
    unstatableCount,
  };
}

/**
 * The lines grouped by how often they are billed, in a stable order.
 *
 * Canopy's Billing step is organised this way — a Weekly block, a Monthly block
 * — because "what do I owe each month" is the question a client actually asks,
 * and a flat list of mixed frequencies cannot answer it.
 */
export function groupByFrequency(
  items: EngagementItemDraft[],
): { frequency: BillingFrequency; items: EngagementItemDraft[] }[] {
  return BILLING_FREQUENCIES.map((frequency) => ({
    frequency,
    items: items.filter((i) => isMeaningful(i) && i.billingFrequency === frequency),
  })).filter((g) => g.items.length > 0);
}

/**
 * Turn the scope into invoice lines.
 *
 * THIS is the founder's constraint made concrete: "these things were
 * implementing would then have to corelate directly to the actual workflow
 * within vylan". The engagement's price is not a second billing system living
 * beside the invoice — it is what the invoice is BUILT FROM, in the exact
 * `payment_requests.line_items` shape migration 0751 already defines.
 *
 * Only statable lines are included: an hourly line has no amount to bill yet,
 * and inventing one would charge the client for a number nobody agreed to.
 */
export function toInvoiceLineItems(
  items: EngagementItemDraft[],
): { description: string; quantity: number; unit_cents: number; amount_cents: number }[] {
  return items
    .filter((i) => isMeaningful(i) && hasStatableTotal(i))
    .map((i) => {
      const cents = i.rateCents ?? 0;
      return {
        description: i.name.trim(),
        quantity: 1,
        unit_cents: cents,
        amount_cents: cents,
      };
    });
}
