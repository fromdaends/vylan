"use server";

// Letting somebody into ONE job, and taking them back out.
//
// OWNER-ONLY, and more firmly than the client cast is. Adding a row here beats
// both privacy flags — it is the one place in the app that opens a private
// client's work to somebody who is not on that client. That is exactly the
// feature ("into one job without opening the whole client"), and exactly why
// the right to do it does not get handed around.
//
// This file exports async functions ONLY. A "use server" module that exports a
// constant compiles fine and then fails the production build naming something
// unrelated.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  addEngagementMember,
  removeEngagementMember,
  EngagementMembersUnsupportedError,
} from "@/lib/db/engagement-members";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export type EngagementMemberResult = {
  ok: boolean;
  /** Set when database update 1320 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "not_allowed" | "not_found" | "save_failed";
};

async function guard(engagementId: string, userId: string) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };
  // Not can(user, "team.manage"): that capability is about the ROSTER, and this
  // is a privacy decision on one row. Owner-only until there is a capability
  // that means this specifically.
  if (user.role !== "owner") return { error: "not_allowed" as const };

  // Both the engagement and the person must be in the caller's own firm. The
  // service-role write does not enforce that, which is exactly why it is
  // checked here — an id from another tenant would otherwise be writable.
  const admin = getServiceRoleSupabase();
  const [{ data: eng }, { data: person }] = await Promise.all([
    admin
      .from("engagements")
      .select("id, firm_id")
      .eq("id", engagementId)
      .maybeSingle(),
    admin.from("users").select("id, firm_id").eq("id", userId).maybeSingle(),
  ]);
  if (
    !eng ||
    !person ||
    (eng as { firm_id?: string }).firm_id !== firm.id ||
    (person as { firm_id?: string }).firm_id !== firm.id
  ) {
    return { error: "not_found" as const };
  }
  return { user, firm };
}

export async function addEngagementMemberAction(input: {
  engagementId: string;
  userId: string;
}): Promise<EngagementMemberResult> {
  const g = await guard(input.engagementId, input.userId);
  if ("error" in g) return { ok: false, error: g.error };

  try {
    await addEngagementMember({
      engagementId: input.engagementId,
      userId: input.userId,
      firmId: g.firm.id,
      actorId: g.user.id,
    });
  } catch (err) {
    if (err instanceof EngagementMembersUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[engagement-members] add failed:", err);
    return { ok: false, error: "save_failed" };
  }

  // Logged because it GRANTS ACCESS. Fire-and-forget: the grant is already
  // committed, and a lost log line is worth less than a control that lags.
  void logUserActivity(g.firm.id, input.engagementId, "engagement_access_granted", {
    target_user_id: input.userId,
  }).catch((e) => console.error("[engagement-members] log failed:", e));

  revalidateAllLocales(`/engagements/${input.engagementId}`);
  return { ok: true };
}

export async function removeEngagementMemberAction(input: {
  engagementId: string;
  userId: string;
}): Promise<EngagementMemberResult> {
  const g = await guard(input.engagementId, input.userId);
  if ("error" in g) return { ok: false, error: g.error };

  try {
    await removeEngagementMember({
      engagementId: input.engagementId,
      userId: input.userId,
      firmId: g.firm.id,
    });
  } catch (err) {
    if (err instanceof EngagementMembersUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[engagement-members] remove failed:", err);
    return { ok: false, error: "save_failed" };
  }

  void logUserActivity(g.firm.id, input.engagementId, "engagement_access_revoked", {
    target_user_id: input.userId,
  }).catch((e) => console.error("[engagement-members] log failed:", e));

  revalidateAllLocales(`/engagements/${input.engagementId}`);
  return { ok: true };
}
