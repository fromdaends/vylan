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

export type ProposalResult = { ok: boolean };

/**
 * The client agrees.
 *
 * ── WHAT THE FOUNDER ASKED FOR ─────────────────────────────────────────────
 *
 * "when the client accepts the proposal the engagement is marked active, the
 * work starts and the client can view their client portal etc etc."
 *
 * So this does all of it in ONE write: accepted, activated, in_progress. That
 * is deliberately different from the firm's two-step (accept, then Activate) —
 * and it is right, because those two steps exist to separate the CLIENT's act
 * from the FIRM's. When the client signs it themselves, both have happened.
 * Making them wait for a firm to press Activate would leave a client who just
 * agreed staring at a portal that says nothing is happening.
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
      activated_at: now,
      status: "in_progress",
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
