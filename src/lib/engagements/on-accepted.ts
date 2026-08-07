// What happens the moment a proposal is agreed to.
//
// ── WHY ONE FUNCTION ───────────────────────────────────────────────────────
//
// There are TWO ways an engagement becomes accepted, and they run in completely
// different worlds:
//
//   * the CLIENT clicks Accept in the portal — no session, no firm, a token and
//     nothing else, service role all the way down;
//   * the FIRM records it on their behalf — an accountant's session, from the
//     builder or the engagement page.
//
// If the billing consequences lived in each of those, they would drift, and the
// half that drifted would be the one that charges money. So both call this.
//
// ── BEST-EFFORT, ALWAYS ────────────────────────────────────────────────────
//
// The acceptance itself has already been written by the time this runs. Nothing
// here may throw its way back out and turn a recorded agreement into an error
// the client sees — a deposit that failed to raise is recoverable (the firm can
// invoice by hand); an acceptance that appeared to fail is not.

import { sendEngagementInvoice } from "@/lib/invoices/send";
import { startRecurringSchedules } from "@/lib/billing/start-schedules";
import {
  acceptanceDueCents,
  acceptanceDueLines,
} from "@/lib/billing/acceptance-lines";
import { acceptanceStartsWorkNow } from "@/lib/engagements/deposit-state";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

/**
 * EVERYTHING a client's acceptance sets in motion, after accepted_at is
 * written: the billing (deposit / on-acceptance invoice / schedules) and
 * then the activation decision — in that order, because "is anything owed?"
 * only means something once the invoices exist (the founder walked into the
 * portal on a $459.90 engagement when the order was wrong).
 *
 * THREE places record a client's agreement and all of them must land here:
 * the portal's Accept button, the firm's accept-on-behalf, and — since
 * sign-to-accept — a signed engagement letter (signwell/complete.ts). The
 * letter path shipping without this was a live blocker: accepted engagements
 * with deposits that were never raised and portals that opened unpaid.
 *
 * Best-effort throughout: the agreement is already recorded, and an
 * accepted-but-not-activated engagement is a visible, recoverable state.
 */
export async function runAcceptanceConsequences(
  engagementId: string,
): Promise<void> {
  await applyAcceptedBilling(engagementId);
  try {
    if (await acceptanceStartsWorkNow(engagementId)) {
      const sb = getServiceRoleSupabase();
      await sb
        .from("engagements")
        .update({
          activated_at: new Date().toISOString(),
          status: "in_progress",
        })
        .eq("id", engagementId)
        .is("activated_at", null);
    }
  } catch (e) {
    console.error("[on-accepted] activation decision failed:", e);
  }
}

export type AcceptedBillingResult = {
  /** The deposit the proposal said was due on acceptance, if one was raised. */
  depositRaised: boolean;
  /** The engagement's own invoice, when the firm chose to bill on acceptance. */
  invoiceRaised: boolean;
  /** True when that invoice was deliberately NOT raised because a payment
   *  schedule already bills this arrangement period by period. */
  invoiceSkippedForSchedule?: boolean;
  /** Frequencies now on a schedule — "monthly" means the client will be
   *  invoiced every month from here on, not just this once. */
  schedulesStarted: string[];
};

/**
 * Raise whatever the acceptance owes.
 *
 * Two independent charges, in the order the client experiences them:
 *
 *  1. THE DEPOSIT — "$1,000 due upon acceptance" on the proposal. Until now
 *     that sentence was decoration: there was no column, no invoice, and
 *     nothing ever asked for the money. It is a real invoice now (1680).
 *
 *  2. THE ENGAGEMENT INVOICE, but only when the firm chose to bill on
 *     acceptance. The founder: "there should be an option for when the invoice
 *     should be sent" — so 'on_acceptance' joins off / now / on completion /
 *     delayed, and this is where it fires.
 *
 * Both are idempotent at the sender and, once 1680 is applied, at the database:
 * one live invoice per engagement PER KIND. Calling this twice raises nothing
 * twice.
 */
/**
 * Is this engagement's client already on a live payment schedule belonging to
 * the same repeating series? Then the arrangement is billed period by period
 * and must not ALSO be billed as a lump sum.
 *
 * Fails CLOSED-ish in the safe direction for money: an unreadable answer
 * returns false, i.e. the flat invoice is raised as it always was. A missing
 * invoice is visible and fixable in one click; a duplicate charge to a client
 * is neither — but so is an arrangement that silently never bills, and this
 * branch only fires for engagements whose firm explicitly chose
 * bill-on-acceptance. Preserving the pre-existing behaviour on an unknown is
 * the smaller surprise.
 */
async function seriesScheduleCovers(engagementId: string): Promise<boolean> {
  try {
    const sb = getServiceRoleSupabase();
    const { data: row, error } = await sb
      .from("engagements")
      .select("series_id")
      .eq("id", engagementId)
      .maybeSingle();
    if (error) return false;
    const seriesId = (row as { series_id?: string | null } | null)?.series_id;
    if (!seriesId) return false;

    const { data: siblings } = await sb
      .from("engagements")
      .select("id")
      .eq("series_id", seriesId);
    const ids = (siblings ?? []).map((s) => (s as { id: string }).id);
    if (ids.length === 0) return false;

    const { data: scheds } = await sb
      .from("engagement_billing_schedules")
      .select("id")
      .in("engagement_id", ids)
      .neq("status", "ended")
      .limit(1);
    return (scheds?.length ?? 0) > 0;
  } catch (e) {
    console.error("[on-accepted] schedule coverage check failed:", e);
    return false;
  }
}

export async function applyAcceptedBilling(
  engagementId: string,
): Promise<AcceptedBillingResult> {
  const out: AcceptedBillingResult = {
    depositRaised: false,
    invoiceRaised: false,
    schedulesStarted: [],
  };

  try {
    const deposit = await sendEngagementInvoice(engagementId, {
      kind: "deposit",
    });
    out.depositRaised = deposit.ok;
  } catch (e) {
    // The agreement stands either way. The firm can raise the deposit by hand.
    console.error("[on-accepted] deposit invoice failed:", e);
  }

  try {
    const sb = getServiceRoleSupabase();
    const { data } = await sb
      .from("engagements")
      .select("invoice_auto_mode")
      .eq("id", engagementId)
      .maybeSingle();
    // ── THE PROPOSAL'S OWN LINES OUTRANK A TYPED NUMBER (1740) ───────────
    //
    // A block saying "$4,000, one time, ON ACCEPTANCE" now bills. Until the
    // timing was persisted, the engagement invoice could only ever charge
    // `invoice_amount_cents` — a figure typed on the Billing tab, unconnected to
    // the priced lines the client actually read and agreed to.
    //
    // So when the engagement has priced one-time lines marked on-acceptance,
    // THEY set the amount. A signed document beats a number typed two tabs away.
    // No such lines (every engagement created before this) and nothing here
    // fires: invoice_auto_mode decides exactly as it does today.
    //
    // Cannot double-bill: both paths raise kind='engagement', and 1680's unique
    // index permits one live invoice per engagement per kind — so the second is
    // rejected at the database and reads as "already sent".
    const dueLines = await acceptanceDueLines(engagementId);
    const dueCents = acceptanceDueCents(dueLines);
    if (dueCents > 0) {
      // Stamp the agreed figure onto the engagement so the ONE sender bills it,
      // keeping the rails gate, the tax computation, the numbering and the
      // pay-link email in a single place rather than growing a second invoice
      // path that would drift from the first.
      await sb
        .from("engagements")
        .update({ invoice_amount_cents: dueCents })
        .eq("id", engagementId);
      // atAcceptance: the engagement is LIVE, not complete. Without it the
      // sender's status gate rejects this outright — which is exactly what it
      // did, silently, for every on-acceptance engagement ever created.
      const invoice = await sendEngagementInvoice(engagementId, {
        atAcceptance: true,
      });
      out.invoiceRaised = invoice.ok;
    } else if (data?.invoice_auto_mode === "on_acceptance") {
      // ── NOT ON TOP OF A CONTINUOUS ARRANGEMENT ──────────────────────────
      //
      // A spawned occurrence inherits the series' flat invoice settings. If
      // the client is ALSO on a payment schedule — the founder's annual job
      // paid monthly — raising that flat amount here charges the whole fee
      // again beside the monthly charges. The lines the client agreed to are
      // billed by the schedule, one period at a time; this branch exists for
      // jobs billed as a single sum, which this is not.
      //
      // Only the FLAT branch is suppressed. One-time lines marked
      // on-acceptance (the branch above) are extra work for this cycle and
      // are billed exactly as they should be.
      const covered = await seriesScheduleCovers(engagementId);
      if (covered) {
        out.invoiceSkippedForSchedule = true;
      } else {
        const invoice = await sendEngagementInvoice(engagementId, {
          atAcceptance: true,
        });
        out.invoiceRaised = invoice.ok;
      }
    }
  } catch (e) {
    console.error("[on-accepted] acceptance invoice failed:", e);
  }

  // 3. THE ONGOING ARRANGEMENT (1710). A proposal that says "$400/month" was
  //    invoiced exactly once — the same shape of broken promise the deposit was
  //    before 1680. Accepting now starts a schedule, and the hourly recurrences
  //    cron raises one invoice per period from here on.
  //
  //    Idempotent at the database (UNIQUE(engagement_id, frequency)), so an
  //    acceptance recorded twice cannot bill the client twice.
  try {
    const started = await startRecurringSchedules(
      engagementId,
      new Date().toISOString().slice(0, 10),
    );
    out.schedulesStarted = started.started;
  } catch (e) {
    console.error("[on-accepted] recurring schedules failed:", e);
  }

  return out;
}
