// Everyone accountable for one engagement — the many-side beside
// engagements.assigned_user_id.
//
// The distinction this module exists to keep straight, because the founder
// asked exactly the right question about it: engagement-members.ts is ACCESS
// ("who was let in to look"), this is ACCOUNTABILITY ("whose job is it"). An
// assignee implies access — migration 1540 widens sight for them — but access
// never implies accountability.
//
// ── THE PRIMARY IS STILL A COLUMN, AND THAT IS ON PURPOSE ──────────────────
//
// `engagements.assigned_user_id` survives as the owner. Six places read it and
// an engagement still benefits from one name that answers for it. This table
// holds the FULL set including that person; the column says which of them is
// primary.
//
// ⚠️ EVERY READ UNIONS THE TWO. A row written before 1540 has a primary and no
// rows here, and must still read as "one assignee" rather than "nobody" — so
// resolveAssignees() puts the primary in the list whether or not the table
// agrees. That also makes the feature degrade correctly while 1540 is
// unapplied: reads return today's single assignee instead of an empty list.
//
// READS DEGRADE, WRITES REFUSE, the same shape as engagement-members.ts.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type EngagementAssignee = {
  engagementId: string;
  userId: string;
  addedAt: string;
};

export class EngagementAssigneesUnsupportedError extends Error {
  constructor() {
    super(
      "Multiple assignees need database update 1540. Run supabase/migrations/1540_engagement_assignees.sql, then try again.",
    );
    this.name = "EngagementAssigneesUnsupportedError";
  }
}

function toAssignee(r: Record<string, unknown>): EngagementAssignee | null {
  const engagementId =
    typeof r.engagement_id === "string" ? r.engagement_id : null;
  const userId = typeof r.user_id === "string" ? r.user_id : null;
  if (!engagementId || !userId) return null;
  return { engagementId, userId, addedAt: String(r.added_at ?? "") };
}

/**
 * The stored extra assignees for one engagement, oldest first.
 *
 * Usually you want resolveAssignees() instead — this one does NOT include the
 * primary unless somebody happened to write a row for them.
 */
export async function listEngagementAssignees(
  engagementId: string,
): Promise<EngagementAssignee[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_assignees")
    .select("engagement_id, user_id, added_at")
    .eq("engagement_id", engagementId)
    .order("added_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? [])
    .map((r) => toAssignee(r as Record<string, unknown>))
    .filter((a): a is EngagementAssignee => a !== null);
}

/**
 * The same, for MANY engagements at once — keyed by engagement id.
 *
 * A list showing faces on forty rows must not run forty queries. Returns an
 * empty Map when 1540 is unapplied, so every caller falls back to the primary
 * and the list renders exactly as it does today.
 */
export async function listAssigneesForEngagements(
  engagementIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (engagementIds.length === 0) return out;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_assignees")
    .select("engagement_id, user_id, added_at")
    .in("engagement_id", engagementIds)
    .order("added_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return out;
    throw error;
  }
  for (const r of data ?? []) {
    const a = toAssignee(r as Record<string, unknown>);
    if (!a) continue;
    const list = out.get(a.engagementId) ?? [];
    list.push(a.userId);
    out.set(a.engagementId, list);
  }
  return out;
}

/**
 * WHO IS ON THIS JOB — the answer every surface should render.
 *
 * PURE, so it is trivially testable and so the union rule lives in exactly one
 * place. The primary comes FIRST and appears exactly once, however the table
 * and the column disagree:
 *
 *   - pre-1540 row (primary, no table rows)      -> [primary]
 *   - 1540 applied, primary also has a row       -> [primary, ...others]
 *   - unassigned engagement with extra assignees -> [...others]
 *   - nothing anywhere                           -> []
 */
export function resolveAssignees(
  primaryUserId: string | null | undefined,
  stored: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (primaryUserId) {
    seen.add(primaryUserId);
    out.push(primaryUserId);
  }
  for (const id of stored ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Put somebody on the job.
 *
 * SERVICE-ROLE, like every other roster write here: the table's own policy
 * grants SELECT only, so the gate is the actions layer. firmId is passed and
 * written rather than derived — a service-role write with no firm scope is how
 * one tenant's row lands in another's table.
 */
export async function addEngagementAssignee(input: {
  engagementId: string;
  userId: string;
  firmId: string;
  actorId?: string | null;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin.from("engagement_assignees").upsert(
    {
      engagement_id: input.engagementId,
      user_id: input.userId,
      firm_id: input.firmId,
      added_by: input.actorId ?? null,
    },
    { onConflict: "engagement_id,user_id" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new EngagementAssigneesUnsupportedError();
    throw error;
  }
}

/**
 * Take somebody off the job.
 *
 * Only removes accountability. Somebody who also has access through the client
 * or through engagement_members keeps it — which is why this is a plain delete
 * and not a "revoke" that has to reason about the other ways in.
 */
export async function removeEngagementAssignee(input: {
  engagementId: string;
  userId: string;
  firmId: string;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin
    .from("engagement_assignees")
    .delete()
    .eq("engagement_id", input.engagementId)
    .eq("user_id", input.userId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new EngagementAssigneesUnsupportedError();
    throw error;
  }
}
