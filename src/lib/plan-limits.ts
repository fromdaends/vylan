// Soft-block plan limit checks. Used both to gate the "Create engagement"
// action server-side AND to drive the "23 / 25 used" indicator the user
// sees in the header. The check is forgiving: if anything goes wrong we
// let the action through and log — we don't want a flaky count to block
// real work.

import { getServerSupabase } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "./plans";
import { BILLING_ENABLED } from "./billing-mode";

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
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data: u } = await sb
    .from("users")
    .select("firm_id")
    .eq("id", auth.user.id)
    .single();
  if (!u?.firm_id) return null;
  const { data: firm } = await sb
    .from("firms")
    .select("plan, trial_ends_at, subscription_status")
    .eq("id", u.firm_id)
    .single();
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

  // While BILLING_ENABLED is false we're selling 1-on-1; nobody's
  // demo should hit an expiration wall pushing them to a Stripe page
  // that doesn't render. Force it off until billing comes back online.
  const trialExpired =
    BILLING_ENABLED &&
    plan === "trial" &&
    firm.trial_ends_at != null &&
    new Date(firm.trial_ends_at) < new Date() &&
    firm.subscription_status !== "active" &&
    firm.subscription_status !== "trialing";

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
