import { cache } from "react";
import {
  listEngagements,
  listItemNamesByEngagement,
  type Engagement,
  type EngagementScope,
} from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { countTasksByEngagement } from "@/lib/db/engagement-tasks";
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

// Public wrapper normalizes the optional clientId so every call site hits the
// cache with the same arity — cache() keys on the exact argument list, and
// ("active") vs ("active", null) would be two entries for the same data.
export function loadEngagementSignals(
  scope: EngagementScope = "active",
  clientId: string | null = null,
): Promise<EngagementSignal[]> {
  return loadEngagementSignalsCached(scope, clientId);
}

const loadEngagementSignalsCached = cache(
  async function _loadEngagementSignals(
    scope: EngagementScope,
    // When set, the whole load is scoped to ONE client's engagements — the
    // client profile's overview needs status pills for a handful of rows and
    // was paying for the firm's entire active book (all engagements + their
    // items + files) to derive them.
    clientId: string | null,
  ): Promise<EngagementSignal[]> {
    const engagements = await listEngagements({
      scope,
      client_id: clientId ?? undefined,
    });
    const sb = await getServerSupabase();
    const liveIds = engagements
      .filter((e) => e.status === "sent" || e.status === "in_progress")
      .map((e) => e.id);

    const [allItemsResp, filesResp] = await Promise.all([
      sb
        .from("request_items")
        // Exactly the fields the two consumers read — computeAttention
        // (status, rejection_reason, required) and computeActionSignals
        // (id, kind) — plus the grouping key. This was select("*"), which
        // dragged every column of every live item (descriptions included)
        // across the wire on each dashboard/worklist render.
        .select("id, engagement_id, kind, status, rejection_reason, required")
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
    const [clients, firmUsers, paymentByEng, tasksByEng, itemNamesByEng] =
      await Promise.all([
      listClients({ includeArchived: false }),
      listFirmUsers(),
      getLatestPaymentStatusByEngagementIds(signals.map((s) => s.engagement.id)),
      // PROGRESS COMES FROM TASKS NOW. Founder: "the completion rate slash
      // progress of an engagement shall no longer be tracked based off the
      // amount of documents have been received. It should be tracked based off
      // the amount of tasks that are finished."
      //
      // Which is right, and it follows from the model change: an engagement is
      // the whole contract, and collecting documents is ONE task inside it. A
      // bar counting approved documents said a job was finished when its
      // paperwork was in — with the return not yet prepared, reviewed, signed
      // or delivered.
      countTasksByEngagement(),
      listItemNamesByEngagement(),
    ]);

    const clientsById = new Map(clients.map((c) => [c.id, c]));
    const userLabelById = new Map(
      firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
    );

    return signals.map(({ engagement: e, attention: a, action, recencyAt }) => {
      // Solid = finished, dim = under way. The same two-tone bar, now reading
      // the firm's own work instead of the client's uploads.
      //
      // ⚠️ attention.ts is UNTOUCHED on purpose. Its completionPct still counts
      // documents, because it drives the chase triggers — due-soon, gone-quiet —
      // and those are about what the CLIENT still owes. Only the DISPLAY bar
      // moves to tasks.
      const taskCounts = tasksByEng.get(e.id);
      const donePct = taskCounts?.total
        ? taskCounts.done / taskCounts.total
        : 0;
      const doingPct = taskCounts?.total
        ? taskCounts.doing / taskCounts.total
        : 0;
      return {
        id: e.id,
        title: e.title,
        clientName: clientsById.get(e.client_id)?.display_name ?? "—",
        clientId: e.client_id,
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
        approvedPct: donePct,
        awaitingPct: doingPct,
        tasksDone: taskCounts?.done ?? 0,
        tasksTotal: taskCounts?.total ?? 0,
        // WHAT WE ARE DOING FOR THEM, and when it started.
        //
        // serviceNames are the engagement's priced lines (#1274) — Canopy's
        // "Service items", and the real answer. `type` stays as the FALLBACK
        // for every engagement created before those existed: one of four fixed
        // values, which reads "Custom" on most real work.
        //
        // sent_at is the honest start — a draft has not begun — with created_at
        // behind it so the column is never empty on a row that plainly exists.
        serviceNames: itemNamesByEng.get(e.id) ?? [],
        type: e.type,
        startedAt: e.sent_at ?? e.created_at ?? null,
        // Acceptance, so the LIST cannot claim one the detail page denies.
        // Without these the row falls back to inferring agreement from client
        // activity — the exact lie fixed in resolveAgreementStatus.
        acceptedAt: e.accepted_at ?? null,
        requiresAcceptance: e.requires_acceptance === true,
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
        // Recurring series linkage (0770); undefined pre-migration → no chip.
        seriesId: e.series_id ?? null,
        // Workflow stage (0690). Read straight off the row — it's kept fresh by
        // the event handlers (see lib/engagements/stage-sync), so no per-row
        // resolution work happens here. undefined pre-migration → the Status
        // column falls back to the derived status pill.
        stage: e.stage ?? null,
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
