"use server";

// Team member rates — the money side of time tracking.
//
// Gated on rates.manage, the capability, NOT the owner rank — the founder's
// ruling verbatim: "billing rates could be transferred over to, like, a senior
// manager who wants to see how each person is being paid... roles only." The
// write itself runs as the CALLER, so RLS (1750) enforces the same capability
// a second time; the check here exists to answer politely.
//
// ⚠️ THE AUDIT ROW CARRIES NO AMOUNTS. activity_log is firm-readable by RLS
// (0002), so a rate value in metadata would hand every staff member the number
// this whole schema exists to keep from them. The row says WHO changed WHOSE
// rate and which fields — never to what.
//
// This file exports async functions ONLY.

import { getCurrentUser, listFirmUsers } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import {
  upsertUserRate,
  UserRatesUnsupportedError,
} from "@/lib/db/user-rates";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

// Sanity ceiling, not a policy: $100,000/h is a typo, and catching it here
// beats a margin chart claiming the firm lost a fortune on a haircut's worth
// of work.
const MAX_RATE = 100_000;

function validRate(value: number | null): boolean {
  if (value === null) return true;
  return Number.isFinite(value) && value >= 0 && value <= MAX_RATE;
}

export async function setMemberRatesAction(input: {
  userId: string;
  /** Dollars CAD per hour; null clears. */
  costRateHourly: number | null;
  billableRateHourly: number | null;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      error:
        | "not_enabled"
        | "not_signed_in"
        | "not_allowed"
        | "invalid"
        | "unsupported"
        | "failed";
    }
> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "not_signed_in" };
  if (!isTimeInsightsEnabled(firm)) return { ok: false, error: "not_enabled" };
  if (!can(user, "rates.manage")) return { ok: false, error: "not_allowed" };
  if (!validRate(input.costRateHourly) || !validRate(input.billableRateHourly)) {
    return { ok: false, error: "invalid" };
  }

  // The target must be a member of THIS firm. The RLS write policy pins
  // firm_id but not the user's own firm membership — without this, a pasted
  // foreign user id would write a rate row pairing our firm with someone
  // else's account.
  const roster = await listFirmUsers();
  const target = roster.find((m) => m.id === input.userId);
  if (!target) return { ok: false, error: "invalid" };

  try {
    await upsertUserRate({
      userId: input.userId,
      firmId: firm.id,
      costRateHourly: input.costRateHourly,
      billableRateHourly: input.billableRateHourly,
      updatedByUserId: user.id,
    });
    await logUserActivity(firm.id, null, "member_rate_changed", {
      target_user_id: input.userId,
      cost_rate_set: input.costRateHourly !== null,
      billable_rate_set: input.billableRateHourly !== null,
    });
    revalidateAllLocales(`/settings/team/${input.userId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof UserRatesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[user-rates] set failed:", err);
    return { ok: false, error: "failed" };
  }
}
