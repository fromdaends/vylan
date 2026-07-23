// Home-page notifications feed. NOT backed by a dedicated table — we
// aggregate signals from the data we already have (AI activity log,
// engagement attention state) so the feed reflects what's actually
// happening in the firm without us inventing a new schema.
//
// IMPORTANT: when a real `notifications` table/inbox is introduced
// later, this module is the single source of truth the Home page
// reads from — swap the body here, the page doesn't change.
//
// Kinds we currently surface (sorted newest first, capped at 12):
//   - ai_auto_rejected         (AI auto-rejected a client upload)
//   - ai_escalated_to_accountant (AI flagged the same file twice)
//   - ai_quality_flagged       (AI flagged a file for review)
//   - document_uploaded        (client uploaded a document — partial
//                               progress, before the whole set is in)
//   - signed_copy_uploaded     (client returned a SIGNED copy of a signature
//                               item — distinct from a plain document upload)
//   - ready_to_review          (client has uploaded every required item —
//                               regardless of the AI's verdict on them)
//   - overdue                  (engagement's due_date has passed)

import {
  listAiActivityForFirm,
  listFirmActivityByActions,
} from "@/lib/db/ai-activity";
import { listEngagements } from "@/lib/db/engagements";
import { listClients, type Client } from "@/lib/db/clients";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  computeAttention,
  isCollectionComplete,
} from "@/lib/attention";

export type HomeNotificationKind =
  | "ai_auto_rejected"
  | "ai_escalated_to_accountant"
  | "ai_quality_flagged"
  | "document_uploaded"
  | "signed_copy_uploaded"
  | "ready_to_review"
  | "overdue"
  // Payment + lifecycle events (sourced from the activity log).
  | "client_paid"
  | "payment_failed"
  | "engagement_completed"
  // A client signed a document via embedded e-signature (the embedded flow
  // replaces the old "signed copy uploaded" upload signal).
  | "client_signed"
  // The client wrote in the engagement's message thread. Its href deep-links
  // into the assistant panel's Client-messages tab (?panel=messages) so the
  // feed's Reply chip lands straight in the conversation.
  | "client_message"
  // A teammate assigned an engagement TO the viewer. Unlike every other kind
  // (which are firm-events anyone relevant sees), this is personally targeted:
  // it only appears for the person the work landed on.
  | "engagement_assigned"
  // A teammate @mentioned the viewer in a file comment (Wave 3). Personally
  // targeted like engagement_assigned — only the mentioned person sees it,
  // regardless of who the engagement is assigned to.
  | "comment_mention";

// Activity-log actions surfaced as notifications (a client paid, a payment
// failed, an engagement was finished, a client signed, a client messaged).
// complete_engagement maps to the engagement_completed kind below.
const EVENT_ACTIONS = [
  "client_paid",
  "payment_failed",
  "complete_engagement",
  "signature_signed",
  "client_message_sent",
] as const;

export type HomeNotification = {
  id: string;
  kind: HomeNotificationKind;
  // Engagement this notification belongs to (null if not engagement-scoped).
  // Drives per-viewer relevance: staff only see notifications for engagements
  // assigned to them; owners see firm-wide.
  engagement_id: string | null;
  // Engagement title — already on the row when relevant. Optional so
  // we can rendere notifications that aren't engagement-scoped later.
  engagement_title: string | null;
  // Engagement lifecycle status — set on client_message rows so the Reply
  // row can open the panel's thread with the right read-only state without
  // navigating. Absent elsewhere.
  engagement_status?: string | null;
  client_display_name: string | null;
  // ISO timestamp. For attention-derived rows (overdue, ready_to_review)
  // we use the engagement's sent_at / due_date for a stable timestamp.
  timestamp: string;
  // Destination when the user clicks. Always a relative path inside
  // the app, no external links.
  href: string;
  // Optional handoff note the assigner left (engagement_assigned rows only).
  note?: string | null;
};

// Whether an `engagement_reassigned` activity should notify the CURRENT viewer
// as the new assignee: the work was assigned TO them, BY someone else, and
// they're STILL the current assignee (not since reassigned away — a stale row
// shouldn't ping). PURE + exported for tests.
export function shouldNotifyAssignee(input: {
  toUserId: string | null;
  actorId: string | null;
  currentAssigneeId: string | null;
  viewerId: string;
}): boolean {
  return (
    input.toUserId === input.viewerId &&
    input.actorId !== input.viewerId &&
    input.currentAssigneeId === input.viewerId
  );
}

// TODO(notifications-table): when we ship a real notifications/inbox
// schema (read-state, dismiss, per-user etc.), replace the body of
// this function with a single query against that table. Callers don't
// need to change. The aggregation pattern below is intentionally
// stateless for now — every load recomputes from current data.
// Per-viewer relevance. Owners (and an unspecified viewer — back-compat) see
// every firm notification. Staff see only notifications for engagements
// assigned to THEM; anything unassigned or assigned to a deactivated member
// falls through to the owner's firm-wide view. PURE + exported for tests.
// Map an activity_log action to its notification kind (or null if it isn't one
// we surface). PURE + exported for tests.
export function eventActionToNotificationKind(
  action: string,
): HomeNotificationKind | null {
  switch (action) {
    case "complete_engagement":
      return "engagement_completed";
    case "client_paid":
      return "client_paid";
    case "payment_failed":
      return "payment_failed";
    case "signature_signed":
      return "client_signed";
    case "client_message_sent":
      return "client_message";
    default:
      return null;
  }
}

export function filterNotificationsForViewer(
  notifications: HomeNotification[],
  assigneeByEngagement: Map<string, string | null>,
  viewer: { userId: string; isOwner: boolean } | undefined,
): HomeNotification[] {
  if (!viewer || viewer.isOwner) return notifications;
  return notifications.filter(
    (n) =>
      // Personally-targeted kinds are already emitted only for this viewer
      // (engagement_assigned via shouldNotifyAssignee, comment_mention via the
      // mention set), so they bypass the assignment scope — a mention on an
      // engagement you don't own must still reach you.
      n.kind === "comment_mention" ||
      n.kind === "engagement_assigned" ||
      (n.engagement_id != null &&
        assigneeByEngagement.get(n.engagement_id) === viewer.userId),
  );
}

export async function listHomeNotifications(
  limit = 12,
  viewer?: { userId: string; isOwner: boolean },
): Promise<HomeNotification[]> {
  // Recency window shared by the AI-activity pull and the "new document
  // uploaded" signal below — the Home glance only cares about the last
  // couple of weeks.
  const recentSinceISO = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [aiActivity, eventActivity, engagements, clients] = await Promise.all([
    listAiActivityForFirm(40, recentSinceISO),
    listFirmActivityByActions(EVENT_ACTIONS, 40, recentSinceISO),
    listEngagements(),
    listClients({ includeArchived: true }),
  ]);

  const clientsById = new Map<string, Client>(clients.map((c) => [c.id, c]));
  // engagement.id -> assigned_user_id, for per-viewer relevance filtering.
  const assigneeByEng = new Map<string, string | null>(
    engagements.map((e) => [e.id, e.assigned_user_id]),
  );
  // engagement.id -> status, for the client_message rows (Reply-in-place).
  const statusByEng = new Map<string, string>(
    engagements.map((e) => [e.id, e.status]),
  );
  const out: HomeNotification[] = [];

  // 0) "Assigned to you" — personally targeted, so only fetched + emitted when
  // we know who's viewing. Sourced from engagement_reassigned activity, which
  // already records who assigned it, to whom, and an optional handoff note.
  if (viewer) {
    const reassigns = await listFirmActivityByActions(
      ["engagement_reassigned"],
      40,
      recentSinceISO,
    );
    for (const a of reassigns) {
      const meta = (a.metadata ?? {}) as {
        to_user_id?: unknown;
        note?: unknown;
      };
      const toUserId =
        typeof meta.to_user_id === "string" ? meta.to_user_id : null;
      if (
        !a.engagement_id ||
        !shouldNotifyAssignee({
          toUserId,
          actorId: a.actor_id,
          currentAssigneeId: assigneeByEng.get(a.engagement_id) ?? null,
          viewerId: viewer.userId,
        })
      ) {
        continue;
      }
      out.push({
        id: a.id,
        kind: "engagement_assigned",
        engagement_id: a.engagement_id,
        engagement_title: a.engagement_title,
        client_display_name: a.client_display_name,
        note: typeof meta.note === "string" ? meta.note.trim() || null : null,
        timestamp: a.created_at,
        href: `/engagements/${a.engagement_id}`,
      });
    }

    // 0b) "@mentioned you in a comment" — also personally targeted. One
    // file_comment_mention activity carries the mentioned ids in metadata; emit
    // for this viewer when they're in the set (and aren't the author).
    // A higher cap than the other feeds: this is fetched firm-wide before the
    // per-viewer filter, and mentions are higher-volume than reassigns, so a
    // small window could drop a specific person's still-recent mention on a busy
    // team. 200 comfortably covers a small firm's 14-day mention volume.
    const mentionRows = await listFirmActivityByActions(
      ["file_comment_mention"],
      200,
      recentSinceISO,
    );
    for (const a of mentionRows) {
      const meta = (a.metadata ?? {}) as { mentioned_user_ids?: unknown };
      const ids = Array.isArray(meta.mentioned_user_ids)
        ? meta.mentioned_user_ids.filter((x): x is string => typeof x === "string")
        : [];
      if (a.actor_id === viewer.userId) continue; // never notify yourself
      if (!ids.includes(viewer.userId)) continue;
      out.push({
        id: a.id,
        kind: "comment_mention",
        engagement_id: a.engagement_id,
        engagement_title: a.engagement_title,
        client_display_name: a.client_display_name,
        timestamp: a.created_at,
        href: a.engagement_id
          ? `/engagements/${a.engagement_id}`
          : "/dashboard",
      });
    }
  }

  // 1) AI signals straight off the existing activity feed.
  for (const a of aiActivity) {
    if (
      a.action === "ai_auto_rejected" ||
      a.action === "ai_escalated_to_accountant" ||
      a.action === "ai_quality_flagged"
    ) {
      out.push({
        id: a.id,
        kind: a.action as HomeNotificationKind,
        engagement_id: a.engagement_id,
        engagement_title: a.engagement_title,
        client_display_name: a.client_display_name,
        timestamp: a.created_at,
        href: a.engagement_id
          ? `/engagements/${a.engagement_id}`
          : "/dashboard",
      });
    }
  }

  // 1b) Payment + lifecycle events straight off the activity feed (a client
  // paid, a payment failed, an engagement was finished).
  for (const a of eventActivity) {
    const kind = eventActionToNotificationKind(a.action);
    if (!kind) continue;
    out.push({
      id: a.id,
      kind,
      engagement_id: a.engagement_id,
      engagement_title: a.engagement_title,
      engagement_status: a.engagement_id
        ? (statusByEng.get(a.engagement_id) ?? null)
        : null,
      client_display_name: a.client_display_name,
      timestamp: a.created_at,
      href: a.engagement_id
        ? // A client message deep-links into the panel's Client-messages tab
          // (kept as a fallback; the feed renders these rows as an in-place
          // panel opener, no navigation).
          kind === "client_message"
          ? `/engagements/${a.engagement_id}?panel=messages`
          : `/engagements/${a.engagement_id}`
        : "/dashboard",
    });
  }

  // 2) Attention-derived signals. Pull items + last-upload activity
  // for the live engagements only.
  const sb = await getServerSupabase();
  const liveIds = engagements
    .filter((e) => e.status === "sent" || e.status === "in_progress")
    .map((e) => e.id);
  if (liveIds.length > 0) {
    const [itemsResp, lastActivityResp] = await Promise.all([
      sb.from("request_items").select("*").in("engagement_id", liveIds),
      sb
        .from("uploaded_files")
        .select("engagement_id, uploaded_at, request_item_id")
        .in("engagement_id", liveIds),
    ]);
    const itemsByEng = new Map<string, NonNullable<typeof itemsResp.data>>();
    // Which request items are signature items — lets us tell a returned SIGNED
    // copy apart from a normal document upload below.
    const signatureItemIds = new Set<string>();
    for (const it of itemsResp.data ?? []) {
      const arr = itemsByEng.get(it.engagement_id) ?? [];
      arr.push(it as never);
      itemsByEng.set(it.engagement_id, arr as never);
      if ((it as { kind?: string }).kind === "signature") {
        signatureItemIds.add((it as { id: string }).id);
      }
    }
    // Most-recent upload per engagement, split by what arrived: ANY file (drives
    // attention + ready-to-review), a document-collection file (drives "document
    // uploaded"), and a signed copy of a signature item (drives the new "signed
    // copy uploaded").
    const lastAnyByEng = new Map<string, string>();
    const lastCollectionByEng = new Map<string, string>();
    const lastSignatureByEng = new Map<string, string>();
    const bump = (m: Map<string, string>, eng: string, at: string) => {
      const prev = m.get(eng);
      if (!prev || at > prev) m.set(eng, at);
    };
    for (const u of lastActivityResp.data ?? []) {
      bump(lastAnyByEng, u.engagement_id, u.uploaded_at);
      if (signatureItemIds.has(u.request_item_id)) {
        bump(lastSignatureByEng, u.engagement_id, u.uploaded_at);
      } else {
        bump(lastCollectionByEng, u.engagement_id, u.uploaded_at);
      }
    }

    for (const e of engagements) {
      if (e.status !== "sent" && e.status !== "in_progress") continue;
      const attention = computeAttention({
        engagement: e,
        items: (itemsByEng.get(e.id) ?? []) as never,
        lastClientActivityAt: lastAnyByEng.get(e.id) ?? null,
      });
      const clientName =
        clientsById.get(e.client_id)?.display_name ?? null;
      const lastAnyAt = lastAnyByEng.get(e.id);
      const lastCollectionAt = lastCollectionByEng.get(e.id);
      const lastSignatureAt = lastSignatureByEng.get(e.id);
      // Fire the moment the client has uploaded a file for every required
      // item — regardless of whether the AI approved, rejected, or hasn't
      // weighed in yet. (The dashboard's "Ready to review" queue still uses the
      // narrower isReadyToReview; this feed is purely "the client finished".)
      if (isCollectionComplete(attention)) {
        out.push({
          id: `ready:${e.id}`,
          kind: "ready_to_review",
          engagement_id: e.id,
          engagement_title: e.title,
          client_display_name: clientName,
          // Use the most recent client upload as the "fresh"
          // timestamp; falls back to sent_at if nothing has uploaded.
          timestamp: lastAnyAt ?? e.sent_at ?? new Date().toISOString(),
          href: `/engagements/${e.id}`,
        });
      } else if (lastCollectionAt && lastCollectionAt >= recentSinceISO) {
        // Set isn't complete yet, but the client uploaded a DOCUMENT recently —
        // surface that progress so the feed shows movement as documents trickle
        // in, not only when everything is finally in. One row per engagement at
        // its newest document upload; naturally replaced by ready_to_review
        // above once the collection completes. Signed copies are handled
        // separately below, so this never double-counts a signature return.
        out.push({
          id: `upload:${e.id}`,
          kind: "document_uploaded",
          engagement_id: e.id,
          engagement_title: e.title,
          client_display_name: clientName,
          timestamp: lastCollectionAt,
          href: `/engagements/${e.id}`,
        });
      }
      // A returned SIGNED copy is its own event, independent of document
      // collection — surface it whenever a signature item got a recent upload.
      if (lastSignatureAt && lastSignatureAt >= recentSinceISO) {
        out.push({
          id: `signed:${e.id}`,
          kind: "signed_copy_uploaded",
          engagement_id: e.id,
          engagement_title: e.title,
          client_display_name: clientName,
          timestamp: lastSignatureAt,
          href: `/engagements/${e.id}`,
        });
      }
      if (attention.reasons.includes("overdue")) {
        out.push({
          id: `overdue:${e.id}`,
          kind: "overdue",
          engagement_id: e.id,
          engagement_title: e.title,
          client_display_name: clientName,
          // Use the due date as the timestamp so overdue items sort
          // by "how recently they became late".
          timestamp: e.due_date
            ? new Date(e.due_date + "T23:59:59").toISOString()
            : new Date().toISOString(),
          href: `/engagements/${e.id}`,
        });
      }
    }
  }

  // De-dupe: an engagement might be both ready_to_review AND have an
  // AI flag on a file — keep both rows, but only one of each kind
  // per engagement (the latest).
  // Scope to the viewer (staff -> their assignments only; owner -> firm-wide)
  // BEFORE dedup/cap, so the cap applies to what they'll actually see.
  const scoped = filterNotificationsForViewer(out, assigneeByEng, viewer);
  const seen = new Set<string>();
  scoped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const deduped: HomeNotification[] = [];
  for (const n of scoped) {
    // Firm-event kinds dedup per engagement (one overdue/ready row each). But a
    // comment_mention is a distinct per-comment event whose href is only the
    // engagement — key it on the activity id so two mentions on the same
    // engagement don't collapse to the latest one.
    const key =
      n.kind === "comment_mention"
        ? `comment_mention:${n.id}`
        : `${n.kind}:${n.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(n);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
