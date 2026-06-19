import { cache } from "react";
import {
  listEngagements,
  type Engagement,
  type EngagementScope,
} from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getLatestPaymentStatusByEngagementIds } from "@/lib/db/payment-requests";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
  deriveEngagementStatus,
  type AttentionResult,
} from "@/lib/attention";
import {
  computeActionSignals,
  type ActionSignals,
  type SignalFile,
} from "@/lib/dashboard/action-signals";
import { DELETED_RETENTION_DAYS } from "@/lib/engagements/lifecycle";
import { getServerSupabase } from "@/lib/supabase/server";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

// Loads engagements as WorklistRows — attention scoring, ready-to-review state,
// completion %, and a "recency" stamp for the Recent sort. Shared by /dashboard
// + /inbox (default "active" scope) and the All-Engagements sub-pages (which
// pass "archived" / "deleted"). Wrapped in React.cache so the layout's badge
// counts and a page's content load — both at "active" scope within one request
// — dedupe to a single DB round-trip. Pass the SAME scope string everywhere to
// share the cache entry.
// Per-engagement attention signals for a lifecycle scope: each engagement row
// plus its computed attention (completion %, ready-to-review, overdue reasons,
// recency). This is the heavy half of a worklist load — engagements + their
// request_items + uploads — WITHOUT the client / team-member name lookups.
// Split out so the sidebar's ready-to-review badge can reuse it (it needs no
// names) and so, within a single request, it dedupes with the full worklist a
// page renders. React.cache'd per scope.
export type EngagementSignal = {
  engagement: Engagement;
  attention: AttentionResult;
  // Needs attention 2.0 file-level signals (flagged uploads, signed copies to
  // confirm, oldest undecided submission). Computed from the same per-file
  // rows the activity stamp already needed.
  action: ActionSignals;
  lastActivityAt: string | null;
  recencyAt: string;
};

export const loadEngagementSignals = cache(
  async function _loadEngagementSignals(
    scope: EngagementScope = "active",
  ): Promise<EngagementSignal[]> {
    const engagements = await listEngagements({ scope });
    const sb = await getServerSupabase();
    const liveIds = engagements
      .filter((e) => e.status === "sent" || e.status === "in_progress")
      .map((e) => e.id);

    const [allItemsResp, filesResp] = await Promise.all([
      sb
        .from("request_items")
        .select("*")
        .in("engagement_id", liveIds.length ? liveIds : [""]),
      // Per-file review/AI state for the action signals + the last-activity
      // stamp. Still one query; just a few more small columns than before.
      sb
        .from("uploaded_files")
        .select(
          "engagement_id, request_item_id, uploaded_at, review_status, ai_rejected, ai_usability, is_duplicate, reviewed_by",
        )
        .in("engagement_id", liveIds.length ? liveIds : [""]),
    ]);

    const itemsByEng = new Map<string, NonNullable<typeof allItemsResp.data>>();
    for (const it of allItemsResp.data ?? []) {
      const arr = itemsByEng.get(it.engagement_id) ?? [];
      arr.push(it as never);
      itemsByEng.set(it.engagement_id, arr as never);
    }
    const files = (filesResp.data ?? []) as (SignalFile & {
      engagement_id: string;
    })[];
    const filesByEng = new Map<string, SignalFile[]>();
    const lastActByEng = new Map<string, string>();
    for (const u of files) {
      const arr = filesByEng.get(u.engagement_id);
      if (arr) arr.push(u);
      else filesByEng.set(u.engagement_id, [u]);
      const prev = lastActByEng.get(u.engagement_id);
      if (!prev || u.uploaded_at > prev) {
        lastActByEng.set(u.engagement_id, u.uploaded_at);
      }
    }

    // "Recency" for the Recent sort: the most recent of created, sent, or last
    // client upload. All ISO 8601, so a string compare is chronological.
    const recencyOf = (e: Engagement): string => {
      let latest = e.created_at;
      if (e.sent_at && e.sent_at > latest) latest = e.sent_at;
      const act = lastActByEng.get(e.id);
      if (act && act > latest) latest = act;
      return latest;
    };

    return engagements.map((e) => ({
      engagement: e,
      attention: computeAttention({
        engagement: e,
        items: (itemsByEng.get(e.id) ?? []) as never,
        lastClientActivityAt: lastActByEng.get(e.id) ?? null,
      }),
      action: computeActionSignals(
        filesByEng.get(e.id) ?? [],
        (itemsByEng.get(e.id) ?? []) as never,
      ),
      lastActivityAt: lastActByEng.get(e.id) ?? null,
      recencyAt: recencyOf(e),
    }));
  },
);

// Loads engagements as WorklistRows — attention scoring, ready-to-review state,
// completion %, and a "recency" stamp for the Recent sort. Shared by /dashboard
// + /inbox (default "active" scope) and the All-Engagements sub-pages (which
// pass "archived" / "deleted"). Builds on loadEngagementSignals (the cached
// heavy part) + adds client + assignee display names. React.cache'd per scope —
// pass the SAME scope string everywhere to share the cache entry.
export const loadEngagementWorklist = cache(
  async function _loadEngagementWorklist(
    scope: EngagementScope = "active",
  ): Promise<WorklistRow[]> {
    // Signals first so we have the engagement ids to batch-load payment status
    // in ONE query alongside clients + users (no N+1). loadEngagementSignals is
    // React.cache'd, so this is usually free on repeat.
    const signals = await loadEngagementSignals(scope);
    const [clients, firmUsers, paymentByEng] = await Promise.all([
      listClients({ includeArchived: false }),
      listFirmUsers(),
      getLatestPaymentStatusByEngagementIds(signals.map((s) => s.engagement.id)),
    ]);

    const clientsById = new Map(clients.map((c) => [c.id, c]));
    const userLabelById = new Map(
      firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
    );

    return signals.map(({ engagement: e, attention: a, action, recencyAt }) => {
      return {
        id: e.id,
        title: e.title,
        clientName: clientsById.get(e.client_id)?.display_name ?? "—",
        status: e.status,
        derivedStatus: deriveEngagementStatus(e.status, a),
        flaggedFilesCount: action.flaggedFiles,
        signedCopiesToConfirm: action.signedCopiesToConfirm,
        waitingSince: action.waitingSince,
        waitingDays: action.waitingDays,
        sittingUnreviewed: action.sittingUnreviewed,
        dueDate: e.due_date,
        assigneeUserId: e.assigned_user_id,
        assigneeName: e.assigned_user_id
          ? (userLabelById.get(e.assigned_user_id) ?? null)
          : null,
        approvedPct: a.approvedPct,
        awaitingPct: a.awaitingPct,
        itemsDone: a.itemsDone,
        itemsTotal: a.itemsTotal,
        attentionScore: attentionScore(a),
        reasons: a.reasons,
        daysOverdue: a.daysOverdue,
        daysUntilDue: a.daysUntilDue,
        daysSinceClientActivity: a.daysSinceClientActivity,
        readyToReview: isReadyToReview(a),
        itemsReadyToReview: a.itemsReadyToReview,
        recencyAt,
        archivedAt: e.archived_at,
        deletedAt: e.deleted_at,
        paymentStatus: paymentByEng.get(e.id)?.status ?? null,
      } satisfies WorklistRow;
    });
  },
);

// Sidebar "Ready to review" badge count. Reuses the cached active-scope signals
// (so on an Engagements/Overview page it dedupes with the page's own load — no
// extra query) and counts ready engagements WITHOUT the client/team-member name
// lookups a full worklist pulls. Same predicate as the worklist's readyToReview,
// so the badge and the Ready view never disagree.
export const countReadyToReview = cache(
  async function _countReadyToReview(): Promise<number> {
    const signals = await loadEngagementSignals("active");
    return signals.filter((s) => isReadyToReview(s.attention)).length;
  },
);

// Sidebar "Recently deleted" badge count — a single COUNT over the 30-day
// soft-delete window, no row payload. (The old path loaded an entire worklist
// for the deleted scope just to take its length.)
export const countRecentlyDeleted = cache(
  async function _countRecentlyDeleted(): Promise<number> {
    const sb = await getServerSupabase();
    const cutoff = new Date(
      Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count, error } = await sb
      .from("engagements")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null)
      .gte("deleted_at", cutoff);
    if (error) throw error;
    return count ?? 0;
  },
);
