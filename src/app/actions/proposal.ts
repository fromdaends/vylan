"use server";

// The CLIENT accepting or declining a proposal.
//
// ── WHY THIS IS NOT IN actions/engagements.ts ──────────────────────────────
//
// Everything there assumes an accountant's session. This is called from the
// portal by somebody holding a link and nothing else — no account, no session,
// no firm. The only credential is the token, so the token is the ONLY thing
// that may be trusted, and every id is looked up FROM it rather than accepted
// from the caller. Mixing the two in one file is how a firm-scoped action ends
// up reachable with a client's token.
//
// Only async exports live here — a `"use server"` module that exports anything
// else fails the production build, and nothing else catches it.

import { revalidatePath } from "next/cache";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { findEngagementForToken, logActivity } from "@/lib/db/portal";
import { runAcceptanceConsequences } from "@/lib/engagements/on-accepted";

export type ProposalResult = { ok: boolean };

/**
 * The client agrees.
 *
 * ── WHAT THE FOUNDER ASKED FOR ─────────────────────────────────────────────
 *
 * "when the client accepts the proposal the engagement is marked active, the
 * work starts and the client can view their client portal etc etc."
 *
 * ...and then, once a deposit could be asked for: "they read the whole proposal
 * and stuff then agree then pay and once they PAY the client portal activates."
 *
 * So acceptance and activation are no longer one write. Agreeing records the
 * agreement; the DEPOSIT opens the portal. When there is no deposit — most
 * engagements — nothing changes: accepting still starts the work in the same
 * breath, which is what the first quote asked for.
 *
 * That remains deliberately different from the firm's two-step (accept, then
 * Activate). Those two steps exist to separate the CLIENT's act from the FIRM's,
 * and when the client signs it themselves both have happened.
 *
 * ── THE AGREEMENT IS WRITTEN EVEN WHEN THE MONEY IS NOT ────────────────────
 *
 * accepted_at is set the instant they click, before any payment. The
 * alternative loses it: a client who agrees and then has a card declined would
 * leave the firm with no record that anybody ever said yes. "Accepted, awaiting
 * deposit" is a real state with a way out — the payment screen is the portal.
 *
 * accepted_by is 'client', never 'firm'. That distinction is the difference
 * between "they signed it" and "we recorded that they agreed", and it must
 * survive.
 */
export async function acceptProposalAction(
  token: string,
): Promise<ProposalResult> {
  if (typeof token !== "string" || token.length === 0) return { ok: false };

  const found = await findEngagementForToken(token);
  if (!found) return { ok: false };

  const sb = getServiceRoleSupabase();

  // ── NO ACCEPTING PAST A LIVE ENGAGEMENT LETTER ─────────────────────────
  // Founder's ruling: when a letter rides the proposal, SIGNING IT is the
  // acceptance — "it doesn't allow the client to accept the proposal
  // without signing the engagement letter." The screen already swaps the
  // Accept button for the signing flow; this is the server refusing the
  // bypass (a stale tab, a replayed request). Pre-1580 (no letter_key
  // column) and any read hiccup fail OPEN to the plain accept — a broken
  // lookup must not lock a client out of agreeing.
  // 'declined' is in the list ON PURPOSE: a client who declined the letter
  // in SignWell has refused the agreement — letting the plain Accept back in
  // would record an acceptance with no signature, the exact bypass this
  // gate exists to stop. 'error' is NOT: an infrastructure failure must not
  // lock a client out of agreeing.
  const { data: letterRows, error: letterErr } = await sb
    .from("signature_requests")
    .select("id")
    .eq("engagement_id", found.id)
    .not("letter_key", "is", null)
    .in("status", ["pending", "sent", "viewed", "declined"])
    .limit(1);
  if (letterErr) {
    // Pre-1580 (no letter_key column) means no letter can exist — accept
    // proceeds. Any OTHER read failure fails CLOSED: the client sees the
    // retryable error and clicks again, which is a smaller harm than an
    // outage window that silently waives the signature requirement.
    if (letterErr.code !== "42703" && letterErr.code !== "PGRST204") {
      console.error("[proposal] letter gate read failed:", letterErr);
      return { ok: false };
    }
  } else if ((letterRows?.length ?? 0) > 0) {
    return { ok: false };
  }

  const now = new Date().toISOString();

  const { error } = await sb
    .from("engagements")
    .update({
      accepted_at: now,
      accepted_by: "client",
      // ACTIVATION IS NOT DECIDED HERE ANY MORE.
      //
      // It used to be, and the answer was always "yes, activate" - because the
      // question was asked BEFORE applyAcceptedBilling had raised anything, so
      // nothing was outstanding yet and the gate saw an empty balance. The
      // founder walked straight into the portal on a $459.90 engagement.
      //
      // The invoices have to exist before "is anything owed?" can mean
      // anything, so the decision moved below, after the billing runs.
      // Accepting withdraws an earlier refusal. A client who declined and then
      // agreed has agreed; leaving the decline on the row would show the firm
      // a contradiction.
      declined_at: null,
      decline_reason: null,
    })
    .eq("id", found.id)
    // Idempotent. A double-submit, a refresh, or a second tab must not move the
    // acceptance time — the first agreement is the one that happened.
    .is("accepted_at", null);

  if (error) {
    console.error("[proposal] accept failed:", error);
    return { ok: false };
  }

  await logActivity(found.firm_id, found.id, "proposal_accepted", {
    accepted_by: "client",
  });
  // Billing (deposit, on-acceptance invoice, schedules), THEN the activation
  // decision — the shared pipeline every acceptance path runs (plain accept
  // here, the firm's on-behalf, and a signed engagement letter), extracted so
  // the half that charges money can never drift between them.
  await runAcceptanceConsequences(found.id);

  // Both sides: the client's portal now shows their documents, and the firm's
  // engagement is live.
  revalidatePath(`/r/${token}`);
  revalidatePath(`/engagements/${found.id}`);
  revalidatePath("/engagements");
  return { ok: true };
}

/**
 * The client says no.
 *
 * NOT terminal, and not destructive. It records the refusal and the reason so
 * the firm can revise and re-send; the proposal stays readable and the client
 * can still accept afterwards. No vendor researched documents a declined state
 * at all, so this shape is Vylan's own — chosen because the alternative is a
 * proposal that sits in "waiting" forever while a client who already decided
 * has to telephone someone.
 *
 * The reason is OPTIONAL. A client who will not explain must still be able to
 * refuse.
 */
export async function declineProposalAction(
  token: string,
  reason: string,
): Promise<ProposalResult> {
  if (typeof token !== "string" || token.length === 0) return { ok: false };

  const found = await findEngagementForToken(token);
  if (!found) return { ok: false };

  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("engagements")
    .update({
      declined_at: new Date().toISOString(),
      decline_reason: typeof reason === "string" && reason.trim().length > 0
        ? reason.trim().slice(0, 2000)
        : null,
    })
    .eq("id", found.id)
    // Declining something already agreed to is not a state anyone chose, and
    // must not silently unpick an acceptance.
    .is("accepted_at", null);

  if (error) {
    console.error("[proposal] decline failed:", error);
    return { ok: false };
  }

  await logActivity(found.firm_id, found.id, "proposal_declined", {});
  revalidatePath(`/r/${token}`);
  revalidatePath(`/engagements/${found.id}`);
  revalidatePath("/engagements");
  return { ok: true };
}
