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
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type AcceptedBillingResult = {
  /** The deposit the proposal said was due on acceptance, if one was raised. */
  depositRaised: boolean;
  /** The engagement's own invoice, when the firm chose to bill on acceptance. */
  invoiceRaised: boolean;
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
export async function applyAcceptedBilling(
  engagementId: string,
): Promise<AcceptedBillingResult> {
  const out: AcceptedBillingResult = {
    depositRaised: false,
    invoiceRaised: false,
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
    if (data?.invoice_auto_mode === "on_acceptance") {
      const invoice = await sendEngagementInvoice(engagementId);
      out.invoiceRaised = invoice.ok;
    }
  } catch (e) {
    console.error("[on-accepted] acceptance invoice failed:", e);
  }

  return out;
}
