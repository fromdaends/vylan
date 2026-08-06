// What a "$4,000, one time, on acceptance" block should charge (1740).
//
// ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
//
// The engagement's invoice has always billed `invoice_amount_cents` — a number
// the accountant types on the Billing tab, or their firm's saved default for
// that engagement type. It has NEVER been connected to the priced lines the
// client actually agreed to.
//
// So a proposal reading "T2 Preparation — $4,000" and "Bookkeeping cleanup —
// $1,200" showed the client $5,200, and the invoice billed whatever separate
// figure was typed two tabs away. Deposits became real in 1680 and recurring
// lines in 1710; the one-time lines — the most common case of all — were still
// decoration.
//
// ── THE PRECEDENCE RULE ────────────────────────────────────────────────────
//
// When the engagement HAS priced one-time lines marked "on acceptance", THOSE
// bill. They are what the client read and agreed to, and a number typed on
// another tab has no claim to outrank a signed document.
//
// Otherwise nothing here fires and invoice_auto_mode behaves exactly as it does
// today. That keeps every existing engagement byte-identical: no line carries a
// timing until it is saved by a build that has this code.
//
// ── IT CANNOT DOUBLE-BILL ──────────────────────────────────────────────────
//
// Both this and invoice_auto_mode='on_acceptance' raise kind='engagement', and
// 1680's unique index permits exactly ONE live invoice per engagement per kind.
// So even if both fired, the second is rejected at the database and reads as
// "already sent". The precedence rule decides WHICH number the client gets; the
// index guarantees they only get one.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type AcceptanceLine = {
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
};

/**
 * The one-time lines this engagement owes the moment it is accepted.
 *
 * Same billability rule as everywhere else: a line with no rate is "we will
 * tell you later", and an HOURLY line has a rate per hour with no known number
 * of hours. Neither can become an invoice without a human, so neither appears
 * here — the totals panel already refuses to state them, and an invoice must
 * not claim more certainty than the proposal it came from.
 *
 * Empty means "nothing to bill on acceptance", which the caller reads as "leave
 * invoice_auto_mode alone" rather than as a failure.
 */
export async function acceptanceDueLines(
  engagementId: string,
): Promise<AcceptanceLine[]> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_items")
    .select("name, rate_cents, rate_type, billing_frequency, billing_timing, order_index")
    .eq("engagement_id", engagementId)
    .eq("billing_frequency", "once")
    .eq("billing_timing", "on_acceptance")
    .order("order_index", { ascending: true });
  if (error) {
    // Pre-1740 there is no billing_timing column, so no line can be marked
    // on-acceptance and the honest answer is none — which leaves today's
    // behaviour exactly in place.
    if (!isMissingSchema(error) && error.code !== "42703") {
      console.error("[billing] acceptance lines read failed:", error.message);
    }
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => {
      const cents = row.rate_cents;
      if (typeof cents !== "number" || cents <= 0) return false;
      const rateType = row.rate_type == null ? "item" : row.rate_type;
      if (rateType !== "item") return false;
      return String(row.name ?? "").trim().length > 0;
    })
    .map((row) => {
      const cents = row.rate_cents as number;
      return {
        description: String(row.name).trim(),
        quantity: 1,
        unit_cents: cents,
        amount_cents: cents,
      };
    });
}

/** What those lines come to, before tax. */
export function acceptanceDueCents(lines: readonly AcceptanceLine[]): number {
  return lines.reduce((sum, l) => sum + l.amount_cents, 0);
}

/**
 * EVERY one-time line this engagement bills, whatever its timing.
 *
 * ── WHY THE INVOICE NEEDS THIS ─────────────────────────────────────────────
 *
 * The automated invoice built exactly ONE line — a flat number typed on the
 * Billing tab, with a free-text description. So a client who agreed to four
 * priced services received a single-line bill that matched none of them, from a
 * product that already contains a full invoice generator with per-line taxes and
 * numbering. The founder: "theres no like actual generate invoice document. When
 * we have a whole invoice generator inside of vylan already."
 *
 * These are the lines the client READ and AGREED TO, so these are the lines the
 * invoice states. Same billability rule as everywhere else — no rate and hourly
 * are both excluded, because neither can become a number without a human.
 *
 * Recurring lines are deliberately absent: they are billed per period by their
 * own schedule (1710), and putting them on the engagement invoice as well would
 * charge the first month twice.
 */
export async function oneTimeInvoiceLines(
  engagementId: string,
): Promise<AcceptanceLine[]> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_items")
    .select("name, rate_cents, rate_type, billing_frequency, order_index")
    .eq("engagement_id", engagementId)
    .eq("billing_frequency", "once")
    .order("order_index", { ascending: true });
  if (error) {
    if (!isMissingSchema(error) && error.code !== "42703") {
      console.error("[billing] one-time lines read failed:", error.message);
    }
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => {
      const cents = row.rate_cents;
      if (typeof cents !== "number" || cents <= 0) return false;
      const rateType = row.rate_type == null ? "item" : row.rate_type;
      if (rateType !== "item") return false;
      return String(row.name ?? "").trim().length > 0;
    })
    .map((row) => {
      const cents = row.rate_cents as number;
      return {
        description: String(row.name).trim(),
        quantity: 1,
        unit_cents: cents,
        amount_cents: cents,
      };
    });
}
