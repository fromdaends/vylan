// Soft-block plan limit checks. Used both to gate the "Create engagement"
// action server-side AND to drive the "23 / 25 used" indicator the user
// sees in the header. The check is forgiving: if anything goes wrong we
// let the action through and log — we don't want a flaky count to block
// real work.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { PLANS, type PlanId } from "./plans";
import { isTrialExpired } from "./trial";

export type LimitState = {
  plan: PlanId;
  activeEngagements: number;
  maxActiveEngagements: number | null;
  canCreateEngagement: boolean;
  userCount: number;
  maxUsers: number | null;
  trialEndsAt: string | null;
  trialExpired: boolean;
};

export async function getFirmLimits(): Promise<LimitState | null> {
  const sb = await getServerSupabase();
  // Rides the request-cached user/firm lookups — this used to re-do auth +
  // users + firms reads (3 round trips) that the layout had already paid for.
  const u = await getCurrentUser();
  if (!u?.firm_id) return null;
  const firm = await getCurrentFirm();
  if (!firm) return null;

  const plan = (firm.plan as PlanId) ?? "trial";
  const cfg = PLANS[plan];

  // Count active engagements (sent + in_progress).
  const { count: active } = await sb
    .from("engagements")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", u.firm_id)
    .in("status", ["sent", "in_progress"]);
  // Count firm users.
  const { count: users } = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", u.firm_id);

  // Free-trial gate: an unconverted trial firm (is_demo) whose 14-day clock
  // has passed — and that isn't covered by an active/trialing subscription —
  // is locked out of write actions until they book a pricing call. Independent
  // of BILLING_ENABLED: the gate now routes to "book a meeting", not Stripe.
  const trialExpired = isTrialExpired(firm);

  const canCreateEngagement =
    !trialExpired &&
    (cfg.maxActiveEngagements == null ||
      (active ?? 0) < cfg.maxActiveEngagements);

  return {
    plan,
    activeEngagements: active ?? 0,
    maxActiveEngagements: cfg.maxActiveEngagements,
    canCreateEngagement,
    userCount: users ?? 0,
    maxUsers: cfg.maxUsers,
    trialEndsAt: firm.trial_ends_at,
    trialExpired,
  };
}
