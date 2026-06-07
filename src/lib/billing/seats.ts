// Seat-cap logic for the team / multi-user feature.
//
// A firm's seat cap is its plan's user limit (src/lib/plans.ts -> PLANS.maxUsers)
// unless an owner has been granted a manual override (firms.seat_cap_override).
// "Used" seats = active (non-deactivated) members + still-pending invitations,
// so a firm can't over-commit by sending more invites than it has room for.
//
// All reads go through the service-role client: seat checks run both in
// owner-only contexts (sending an invite) AND in the public accept flow, which
// re-checks the cap with no authenticated owner session.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/plans";

// Safe fallback when a firm's plan string isn't one we recognize. Conservative
// on purpose: better to under-provision and let the owner contact us than to
// silently hand out unlimited seats.
export const UNKNOWN_PLAN_SEAT_CAP = 1;

export class SeatLimitError extends Error {
  readonly cap: number;
  constructor(cap: number) {
    super(`Firm seat limit reached (cap ${cap})`);
    this.name = "SeatLimitError";
    this.cap = cap;
  }
}

export type SeatUsage = {
  activeUsers: number;
  pendingInvites: number;
  total: number;
  cap: number;
  remaining: number;
};

// PURE. Resolve a firm's effective seat cap from its plan + optional override.
// A positive override always wins; otherwise the plan's maxUsers; an unknown
// plan falls back to UNKNOWN_PLAN_SEAT_CAP. A plan whose maxUsers is null means
// "unlimited users" -> Infinity.
export function resolveSeatCap(
  plan: string | null | undefined,
  override: number | null | undefined,
): number {
  if (
    typeof override === "number" &&
    Number.isFinite(override) &&
    override > 0
  ) {
    return Math.floor(override);
  }
  if (plan && plan in PLANS) {
    const max = PLANS[plan as PlanId].maxUsers;
    return max == null ? Number.POSITIVE_INFINITY : max;
  }
  return UNKNOWN_PLAN_SEAT_CAP;
}

// PURE. Assemble a usage summary from raw counts + the resolved cap.
export function summarizeSeatUsage(input: {
  activeUsers: number;
  pendingInvites: number;
  cap: number;
}): SeatUsage {
  const activeUsers = Math.max(0, input.activeUsers);
  const pendingInvites = Math.max(0, input.pendingInvites);
  const total = activeUsers + pendingInvites;
  const remaining = Number.isFinite(input.cap)
    ? Math.max(0, input.cap - total)
    : Number.POSITIVE_INFINITY;
  return { activeUsers, pendingInvites, total, cap: input.cap, remaining };
}

// PURE. Throw SeatLimitError when there is no room for one more seat.
export function assertSeatAvailable(usage: SeatUsage): void {
  if (usage.remaining <= 0) throw new SeatLimitError(usage.cap);
}

// The effective seat cap for a firm (plan default, or its override).
export async function getFirmSeatCap(firmId: string): Promise<number> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("firms")
    .select("plan, seat_cap_override")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data) {
    console.warn(
      `[seats] could not load firm ${firmId} for seat cap; using fallback`,
      error?.message,
    );
    return UNKNOWN_PLAN_SEAT_CAP;
  }
  if (!(typeof data.plan === "string" && data.plan in PLANS)) {
    console.warn(
      `[seats] firm ${firmId} has unrecognized plan "${data.plan}"; using fallback cap`,
    );
  }
  return resolveSeatCap(data.plan, data.seat_cap_override);
}

// Full seat-usage snapshot: active members + pending invites vs the cap.
export async function getFirmSeatUsage(firmId: string): Promise<SeatUsage> {
  const sb = getServiceRoleSupabase();
  const nowIso = new Date().toISOString();
  const [firmResp, activeResp, pendingResp] = await Promise.all([
    sb
      .from("firms")
      .select("plan, seat_cap_override")
      .eq("id", firmId)
      .maybeSingle(),
    // Active = not deactivated. The owner counts as a seat too.
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId)
      .is("deactivated_at", null),
    // Pending = sent, not yet accepted, not revoked, not expired.
    sb
      .from("firm_invites")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso),
  ]);
  const cap = resolveSeatCap(
    firmResp.data?.plan,
    firmResp.data?.seat_cap_override,
  );
  return summarizeSeatUsage({
    activeUsers: activeResp.count ?? 0,
    pendingInvites: pendingResp.count ?? 0,
    cap,
  });
}

// Throws SeatLimitError when the firm has no room for one more member.
// Called by createInvite (owner) and re-checked in the accept flow.
export async function assertCanAddSeat(firmId: string): Promise<void> {
  assertSeatAvailable(await getFirmSeatUsage(firmId));
}
