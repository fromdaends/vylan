// Making sure an engagement HAS a proposal before it goes to the client.
//
// ── WHAT WENT WRONG ────────────────────────────────────────────────────────
//
// `proposal` (and the `requires_acceptance` flag derived from it) was written in
// exactly ONE place in the whole app: createEngagementWithItems, at creation.
// Nothing else ever wrote it. Two consequences, and the founder hit both:
//
//   1. Every engagement created before the proposal was actually being saved is
//      permanently a plain document request. Pulling it back to draft and
//      re-sending changes nothing, because send only flips a status — it never
//      captured a proposal, so there was none to capture.
//
//   2. More generally: EDITING an engagement after creating it never updated
//      what the client would read. Add services, a deposit, terms — re-send —
//      and the client still gets whatever was frozen (or not frozen) on day one.
//
// The founder, having pulled one back to draft and re-sent it: "the email hasnt
// changed and neither the portal."
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// On SEND, rebuild the proposal from what the engagement actually contains —
// unless a client has already ACCEPTED it, in which case it is a signed
// agreement and must never change under them.
//
// That makes "pull back to draft, fix it, send again" mean what it looks like it
// means, and it repairs every pre-existing engagement the first time it is
// re-sent.
//
// ── WHAT IT CAN AND CANNOT RECOVER ─────────────────────────────────────────
//
// Built from columns that genuinely exist on the engagement: its title, its
// intro message, its deposit, its start date, and its priced service lines.
//
// Terms, extra signers, the video and the price-visibility switches live ONLY
// inside the proposal jsonb — the builder is the only thing that has ever known
// them. So a rebuild cannot invent them, and it does not pretend to: an
// engagement rebuilt this way carries no terms until someone opens the builder
// and adds them. Honest and incomplete beats confident and wrong.
//
// A proposal already present is REFRESHED rather than left alone (while
// unaccepted), so an edit reaches the client — but the fields only the builder
// knows are carried over from the existing snapshot rather than being blanked.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  proposalIsPresentable,
  readProposalSnapshot,
} from "@/lib/engagements/proposal-snapshot";

/**
 * Give this engagement a proposal that matches what it currently contains.
 *
 * Best-effort and total: it runs inside the send path, and an engagement that
 * failed to go out because a proposal could not be rebuilt would be far worse
 * than one that goes out as a plain document request — which is exactly what it
 * did before this existed.
 *
 * Returns true when the engagement now carries a presentable proposal.
 */
export async function ensureProposalForSend(
  engagementId: string,
): Promise<boolean> {
  try {
    const sb = getServiceRoleSupabase();

    const { data: engRow, error } = await sb
      .from("engagements")
      .select(
        "id, title, intro_message, deposit_cents, start_date, proposal, requires_acceptance, accepted_at",
      )
      .eq("id", engagementId)
      .maybeSingle();
    if (error || !engRow) return false;

    const eng = engRow as {
      title: string | null;
      intro_message: string | null;
      deposit_cents: number | null;
      start_date: string | null;
      proposal: Record<string, unknown> | null;
      requires_acceptance: boolean | null;
      accepted_at: string | null;
    };

    // ⚠️ A SIGNED AGREEMENT IS NEVER REWRITTEN. Once a client has accepted, the
    // frozen document is the contract, and re-sending must not change a word of
    // what they agreed to.
    if (eng.accepted_at != null) return eng.requires_acceptance === true;

    // The priced lines, read fresh — this is the part that actually changes when
    // an accountant edits an engagement.
    const { data: itemRows } = await sb
      .from("engagement_items")
      .select("name, rate_cents, billing_frequency, tax_pct, order_index")
      .eq("engagement_id", engagementId)
      .order("order_index", { ascending: true });

    const services = ((itemRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        name: String(row.name ?? "").trim(),
        rateCents: (row.rate_cents as number | null) ?? null,
        billingFrequency: (row.billing_frequency as string | null) ?? "once",
        taxPct: (row.tax_pct as number | null) ?? null,
      }))
      .filter((s) => s.name.length > 0);

    // Everything the builder knows and no column does — terms, signers, the
    // video, the visibility switches — survives from the existing snapshot. A
    // rebuild must not silently delete terms somebody wrote.
    const prev = eng.proposal ?? {};

    const next: Record<string, unknown> = {
      ...prev,
      engagementName: eng.title ?? "",
      welcome: eng.intro_message ?? (prev.welcome as string | null) ?? null,
      depositCents:
        typeof eng.deposit_cents === "number" && eng.deposit_cents > 0
          ? eng.deposit_cents
          : null,
      periodStartsOn: eng.start_date ? "custom" : "acceptance",
      services,
    };

    // Never turn a bare document request into a contract. An engagement with no
    // title, no priced lines and no terms has nothing for a client to agree to,
    // and showing them an Accept button on a blank page is worse than the
    // document checklist they would otherwise get.
    const preview = readProposalSnapshot(next, "");
    if (!proposalIsPresentable(preview)) return false;

    const { error: updErr } = await sb
      .from("engagements")
      .update({ proposal: next, requires_acceptance: true })
      .eq("id", engagementId)
      // Belt and braces alongside the early return above: the WHERE clause makes
      // it impossible to rewrite an accepted agreement even if this is somehow
      // called twice with an acceptance landing in between.
      .is("accepted_at", null);
    if (updErr) {
      // Pre-1650 has neither column. The engagement still sends, as a plain
      // document request — exactly today's behaviour.
      if (!isMissingSchema(updErr)) {
        console.error("[ensure-proposal] update failed:", updErr.message);
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error("[ensure-proposal] failed:", e);
    return false;
  }
}
