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
import { applyAcceptedBilling } from "@/lib/engagements/on-accepted";
import { acceptanceStartsWorkNow } from "@/lib/engagements/deposit-state";

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
  // Raise whatever the acceptance owes — the deposit the proposal promised,
  // and the engagement invoice when the firm chose to bill on acceptance.
  // Shared with the firm's own accept path so the two cannot diverge, and
  // best-effort inside: a billing hiccup must never turn a recorded agreement
  // into an error on the client's screen.
  await applyAcceptedBilling(found.id);

  // NOW decide whether work starts.
  //
  // The deposit and any on-acceptance invoice exist by this point, so the
  // question has a real answer. Nothing owed (or no way to collect it) and the
  // engagement goes live exactly as it always did; anything outstanding and the
  // portal shows the payment screen until recordInvoicePaid settles the last of
  // it.
  //
  // Best-effort: the agreement is already recorded, and an engagement that is
  // accepted-but-not-activated is a visible, recoverable state. Failing the
  // client's Accept click over it would not be.
  try {
    if (await acceptanceStartsWorkNow(found.id)) {
      await sb
        .from("engagements")
        .update({ activated_at: now, status: "in_progress" })
        .eq("id", found.id)
        .is("activated_at", null);
    }
  } catch (e) {
    console.error("[proposal] activation decision failed:", e);
  }

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
