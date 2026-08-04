"use server";

// Putting people on a job, and taking them off.
//
// ⚠️ NOT OWNER-ONLY, unlike engagement-members.ts, and the difference is the
// point. That file hands out ACCESS — it opens a private client's work to
// somebody who is not on that client, so the right to do it does not get
// passed around. This file hands out WORK, which anybody on the team already
// does: reassignEngagementAction has never been owner-gated, and the founder's
// standing position is that everyone can move and complete work.
//
// ── THE PRIMARY IS KEPT HONEST ─────────────────────────────────────────────
//
// engagements.assigned_user_id survives as the owner and six things read it,
// so it must never drift into nonsense:
//   - adding somebody to a job with NO primary makes them the primary
//   - removing the primary PROMOTES the next assignee, and only nulls the
//     column when they were the last one
// Otherwise a job could show three faces and read "Unassigned" in the list.
//
// This file exports async functions ONLY. A "use server" module that exports a
// constant compiles fine and then fails the production build naming something
// unrelated.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  addEngagementAssignee,
  removeEngagementAssignee,
  listEngagementAssignees,
  EngagementAssigneesUnsupportedError,
} from "@/lib/db/engagement-assignees";
import { revalidateAllLocales } from "@/lib/revalidate";

export type EngagementAssigneeResult = {
  ok: boolean;
  /** Set when database update 1540 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "not_found" | "save_failed";
};

async function guard(engagementId: string, userId: string) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };

  // Both the engagement and the person must be in the caller's own firm. The
  // service-role write does not enforce that, which is exactly why it is
  // checked here — an id from another tenant would otherwise be writable.
  const admin = getServiceRoleSupabase();
  const [{ data: eng }, { data: person }] = await Promise.all([
    admin
      .from("engagements")
      .select("id, firm_id, assigned_user_id")
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
  return {
    user,
    firm,
    primary: (eng as { assigned_user_id?: string | null }).assigned_user_id ?? null,
  };
}

async function setPrimary(engagementId: string, userId: string | null) {
  const admin = getServiceRoleSupabase();
  await admin
    .from("engagements")
    .update({ assigned_user_id: userId })
    .eq("id", engagementId);
}

export async function addEngagementAssigneeAction(input: {
  engagementId: string;
  userId: string;
}): Promise<EngagementAssigneeResult> {
  const g = await guard(input.engagementId, input.userId);
  if ("error" in g) return { ok: false, error: g.error };
  try {
    await addEngagementAssignee({
      engagementId: input.engagementId,
      userId: input.userId,
      firmId: g.firm.id,
      actorId: g.user.id,
    });
    // First person onto an unassigned job owns it, so the list's "Assigned to"
    // column and the attention scoring have somebody to name.
    if (!g.primary) await setPrimary(input.engagementId, input.userId);
    revalidateAllLocales(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof EngagementAssigneesUnsupportedError) {
      return { ok: false, needsMigration: true, error: "save_failed" };
    }
    return { ok: false, error: "save_failed" };
  }
}

export async function removeEngagementAssigneeAction(input: {
  engagementId: string;
  userId: string;
}): Promise<EngagementAssigneeResult> {
  const g = await guard(input.engagementId, input.userId);
  if ("error" in g) return { ok: false, error: g.error };
  try {
    await removeEngagementAssignee({
      engagementId: input.engagementId,
      userId: input.userId,
      firmId: g.firm.id,
    });
    // Taking the OWNER off promotes whoever is left rather than leaving three
    // faces above the word "Unassigned". Only the last one out nulls it.
    if (g.primary === input.userId) {
      const rest = (await listEngagementAssignees(input.engagementId)).filter(
        (a) => a.userId !== input.userId,
      );
      await setPrimary(input.engagementId, rest[0]?.userId ?? null);
    }
    revalidateAllLocales(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof EngagementAssigneesUnsupportedError) {
      return { ok: false, needsMigration: true, error: "save_failed" };
    }
    return { ok: false, error: "save_failed" };
  }
}
