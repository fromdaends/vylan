// Who has been let into ONE job — reading and writing per-engagement access.
//
// The narrow sibling of client-members.ts. Being on a CLIENT gets you
// everything under it; being on an ENGAGEMENT gets you that engagement, its
// files, and the client's NAME so the row is not attributed to "—". Nothing
// else — the client's other work stays exactly as hidden as it was.
//
// The whole enforcement lives in migration 1310, not here. Ten child tables
// already gate on `engagement_is_private()`, so teaching that one function
// about this table opens exactly the right doors. This module is the roster.
//
// READS DEGRADE, WRITES REFUSE, same shape as client-members.ts. Before 1310 is
// applied there is no table: a read returns "nobody has been let in", which is
// the truth, and a write names the file to run rather than failing with a
// Postgres error nobody can act on.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type EngagementMember = {
  engagementId: string;
  userId: string;
  addedAt: string;
};

export class EngagementMembersUnsupportedError extends Error {
  constructor() {
    super(
      "Per-job access needs database update 1310. Run supabase/migrations/1310_engagement_members.sql, then try again.",
    );
    this.name = "EngagementMembersUnsupportedError";
  }
}

function toMember(r: Record<string, unknown>): EngagementMember | null {
  const engagementId =
    typeof r.engagement_id === "string" ? r.engagement_id : null;
  const userId = typeof r.user_id === "string" ? r.user_id : null;
  if (!engagementId || !userId) return null;
  return { engagementId, userId, addedAt: String(r.added_at ?? "") };
}

/** Everyone let into one engagement, oldest first. */
export async function listEngagementMembers(
  engagementId: string,
): Promise<EngagementMember[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_members")
    .select("engagement_id, user_id, added_at")
    .eq("engagement_id", engagementId)
    .order("added_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? [])
    .map((r) => toMember(r as Record<string, unknown>))
    .filter((m): m is EngagementMember => m !== null);
}

/**
 * Let somebody into one engagement.
 *
 * SERVICE-ROLE, like every other roster write in this codebase: the table's own
 * policy grants SELECT only, so the gate is the actions layer. firmId is passed
 * and written rather than derived here — the caller has already established
 * which firm it is talking about, and a service-role write with no firm scope
 * is how one tenant's row lands in another's table.
 */
export async function addEngagementMember(input: {
  engagementId: string;
  userId: string;
  firmId: string;
  actorId?: string | null;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin.from("engagement_members").upsert(
    {
      engagement_id: input.engagementId,
      user_id: input.userId,
      firm_id: input.firmId,
      added_by: input.actorId ?? null,
    },
    { onConflict: "engagement_id,user_id" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new EngagementMembersUnsupportedError();
    throw error;
  }
}

/**
 * Take somebody back out.
 *
 * Removing the row removes ONLY what this row granted. Somebody who is also on
 * the client keeps everything the client gave them — which is why this is a
 * plain delete and not a "revoke" that has to reason about other paths in.
 */
export async function removeEngagementMember(input: {
  engagementId: string;
  userId: string;
  firmId: string;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin
    .from("engagement_members")
    .delete()
    .eq("engagement_id", input.engagementId)
    .eq("user_id", input.userId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new EngagementMembersUnsupportedError();
    throw error;
  }
}
