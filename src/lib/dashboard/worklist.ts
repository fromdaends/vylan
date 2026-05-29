import { cache } from "react";
import {
  listEngagements,
  type Engagement,
  type EngagementScope,
} from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
} from "@/lib/attention";
import { getServerSupabase } from "@/lib/supabase/server";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

// Loads engagements as WorklistRows — attention scoring, ready-to-review state,
// completion %, and a "recency" stamp for the Recent sort. Shared by /dashboard
// + /inbox (default "active" scope) and the All-Engagements sub-pages (which
// pass "archived" / "deleted"). Wrapped in React.cache so the layout's badge
// counts and a page's content load — both at "active" scope within one request
// — dedupe to a single DB round-trip. Pass the SAME scope string everywhere to
// share the cache entry.
export const loadEngagementWorklist = cache(async function _loadEngagementWorklist(
  scope: EngagementScope = "active",
): Promise<WorklistRow[]> {
  const [engagements, clients, firmUsers] = await Promise.all([
    listEngagements({ scope }),
    listClients({ includeArchived: false }),
    listFirmUsers(),
  ]);

  const sb = await getServerSupabase();
  const liveIds = engagements
    .filter((e) => e.status === "sent" || e.status === "in_progress")
    .map((e) => e.id);

  const [allItemsResp, lastActivityResp] = await Promise.all([
    sb
      .from("request_items")
      .select("*")
      .in("engagement_id", liveIds.length ? liveIds : [""]),
    sb
      .from("uploaded_files")
      .select("engagement_id, uploaded_at")
      .in("engagement_id", liveIds.length ? liveIds : [""]),
  ]);

  const itemsByEng = new Map<string, NonNullable<typeof allItemsResp.data>>();
  for (const it of allItemsResp.data ?? []) {
    const arr = itemsByEng.get(it.engagement_id) ?? [];
    arr.push(it as never);
    itemsByEng.set(it.engagement_id, arr as never);
  }
  const lastActByEng = new Map<string, string>();
  for (const u of lastActivityResp.data ?? []) {
    const prev = lastActByEng.get(u.engagement_id);
    if (!prev || u.uploaded_at > prev) {
      lastActByEng.set(u.engagement_id, u.uploaded_at);
    }
  }

  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const userLabelById = new Map(
    firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
  );

  // "Recency" for the Recent sort: the most recent of created, sent, or last
  // client upload. All ISO 8601, so a string compare is chronological.
  const recencyOf = (e: Engagement): string => {
    let latest = e.created_at;
    if (e.sent_at && e.sent_at > latest) latest = e.sent_at;
    const act = lastActByEng.get(e.id);
    if (act && act > latest) latest = act;
    return latest;
  };

  return engagements.map((e) => {
    const a = computeAttention({
      engagement: e,
      items: (itemsByEng.get(e.id) ?? []) as never,
      lastClientActivityAt: lastActByEng.get(e.id) ?? null,
    });
    return {
      id: e.id,
      title: e.title,
      clientName: clientsById.get(e.client_id)?.display_name ?? "—",
      status: e.status,
      dueDate: e.due_date,
      assigneeUserId: e.assigned_user_id,
      assigneeName: e.assigned_user_id
        ? (userLabelById.get(e.assigned_user_id) ?? null)
        : null,
      completionPct: a.completionPct,
      itemsDone: a.itemsDone,
      itemsTotal: a.itemsTotal,
      attentionScore: attentionScore(a),
      reasons: a.reasons,
      daysOverdue: a.daysOverdue,
      daysUntilDue: a.daysUntilDue,
      daysSinceClientActivity: a.daysSinceClientActivity,
      readyToReview: isReadyToReview(a),
      itemsReadyToReview: a.itemsReadyToReview,
      recencyAt: recencyOf(e),
      archivedAt: e.archived_at,
      deletedAt: e.deleted_at,
    } satisfies WorklistRow;
  });
});
