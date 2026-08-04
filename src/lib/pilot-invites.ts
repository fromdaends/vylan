// Pilot invites (migration 1490).
//
// A pilot is a comped, time-boxed evaluation account (migration 1250): metered
// monthly through firms.ai_monthly_cap rather than the free trial's ten-checks-
// for-life ceiling, while is_demo + trial_ends_at still end it on schedule.
//
// Switching that on by hand AFTER the firm exists leaves a window: until someone
// notices the signup and goes and flips it, the pilot firm is an ordinary trial
// and burns through ten AI checks on its first afternoon. This module closes the
// window by pre-authorising the email, so onboarding can apply the pilot terms
// at the instant it creates the firm.
//
// Everything here fails SAFE toward an ordinary trial. Signup is the single most
// important flow in the product; a missing table, an unapplied migration or a
// transient outage must degrade a pilot to a normal 14-day trial, never block
// the person from creating their account.

import { getServiceRoleSupabase } from "@/lib/supabase/server";

const DAY_MS = 86_400_000;

export type PilotInvite = {
  email: string;
  ai_monthly_cap: number;
  pilot_days: number;
};

/** The firm columns a redeemed invite contributes at firm-creation time.
 *  Split out and PURE so the terms are testable without a database: the cost of
 *  getting these three values wrong is a pilot that is silently capped at ten
 *  checks, or one that never expires. `nowMs` is the SIGNUP instant, not the
 *  instant the invite was created — a pilot invited today and signing up in
 *  three weeks still gets their full pilot_days. */
export function pilotFirmFields(
  invite: Pick<PilotInvite, "ai_monthly_cap" | "pilot_days">,
  nowMs: number,
): { is_pilot: true; ai_monthly_cap: number; trial_ends_at: string } {
  return {
    is_pilot: true,
    ai_monthly_cap: invite.ai_monthly_cap,
    trial_ends_at: new Date(nowMs + invite.pilot_days * DAY_MS).toISOString(),
  };
}

/** An outstanding pilot invite for this email, or null. Null means "sign this
 *  firm up as a normal trial" — which is also what every failure returns, so a
 *  broken lookup can never block a signup. Already-redeemed invites return null
 *  so one invite cannot furnish two firms. */
export async function findPilotInvite(
  email: string | null | undefined,
): Promise<PilotInvite | null> {
  if (!email) return null;
  try {
    const sb = getServiceRoleSupabase();
    const { data, error } = await sb
      .from("pilot_invites")
      .select("email, ai_monthly_cap, pilot_days, redeemed_at")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    // `error` covers the table not existing yet (1490 unapplied) — treated the
    // same as "no invite", so deploying this before the migration is harmless.
    if (error || !data) return null;
    if (data.redeemed_at) return null;
    if (
      typeof data.ai_monthly_cap !== "number" ||
      typeof data.pilot_days !== "number"
    ) {
      return null;
    }
    return {
      email: data.email as string,
      ai_monthly_cap: data.ai_monthly_cap,
      pilot_days: data.pilot_days,
    };
  } catch {
    return null;
  }
}

/** Stamp an invite as consumed. Best-effort and deliberately un-awaited-safe:
 *  the firm is already created by this point, so a failure here must not surface
 *  as a signup error. Worst case the invite stays outstanding and someone
 *  redeems it twice, which is visible in the table rather than silent. */
export async function markPilotInviteRedeemed(
  email: string,
  firmId: string,
): Promise<void> {
  try {
    const sb = getServiceRoleSupabase();
    await sb
      .from("pilot_invites")
      .update({
        redeemed_at: new Date().toISOString(),
        redeemed_firm_id: firmId,
      })
      .eq("email", email.trim().toLowerCase())
      .is("redeemed_at", null);
  } catch {
    // swallow — see the doc comment.
  }
}
