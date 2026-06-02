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
//   - ready_to_review          (client has uploaded every required item —
//                               regardless of the AI's verdict on them)
//   - overdue                  (engagement's due_date has passed)

import { listAiActivityForFirm } from "@/lib/db/ai-activity";
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
  | "ready_to_review"
  | "overdue";

export type HomeNotification = {
  id: string;
  kind: HomeNotificationKind;
  // Engagement title — already on the row when relevant. Optional so
  // we can rendere notifications that aren't engagement-scoped later.
  engagement_title: string | null;
  client_display_name: string | null;
  // ISO timestamp. For attention-derived rows (overdue, ready_to_review)
  // we use the engagement's sent_at / due_date for a stable timestamp.
  timestamp: string;
  // Destination when the user clicks. Always a relative path inside
  // the app, no external links.
  href: string;
};

// TODO(notifications-table): when we ship a real notifications/inbox
// schema (read-state, dismiss, per-user etc.), replace the body of
// this function with a single query against that table. Callers don't
// need to change. The aggregation pattern below is intentionally
// stateless for now — every load recomputes from current data.
export async function listHomeNotifications(
  limit = 12,
): Promise<HomeNotification[]> {
  // Recency window shared by the AI-activity pull and the "new document
  // uploaded" signal below — the Home glance only cares about the last
  // couple of weeks.
  const recentSinceISO = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [aiActivity, engagements, clients] = await Promise.all([
    listAiActivityForFirm(40, recentSinceISO),
    listEngagements(),
    listClients({ includeArchived: true }),
  ]);

  const clientsById = new Map<string, Client>(clients.map((c) => [c.id, c]));
  const out: HomeNotification[] = [];

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
        engagement_title: a.engagement_title,
        client_display_name: a.client_display_name,
        timestamp: a.created_at,
        href: a.engagement_id
          ? `/engagements/${a.engagement_id}`
          : "/dashboard",
      });
    }
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
        .select("engagement_id, uploaded_at")
        .in("engagement_id", liveIds),
    ]);
    const itemsByEng = new Map<string, NonNullable<typeof itemsResp.data>>();
    for (const it of itemsResp.data ?? []) {
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

    for (const e of engagements) {
      if (e.status !== "sent" && e.status !== "in_progress") continue;
      const attention = computeAttention({
        engagement: e,
        items: (itemsByEng.get(e.id) ?? []) as never,
        lastClientActivityAt: lastActByEng.get(e.id) ?? null,
      });
      const clientName =
        clientsById.get(e.client_id)?.display_name ?? null;
      const lastUploadAt = lastActByEng.get(e.id);
      // Fire the moment the client has uploaded a file for every required
      // item — regardless of whether the AI approved, rejected, or hasn't
      // weighed in yet. (The dashboard's "Ready to review" queue still uses the
      // narrower isReadyToReview; this feed is purely "the client finished".)
      if (isCollectionComplete(attention)) {
        out.push({
          id: `ready:${e.id}`,
          kind: "ready_to_review",
          engagement_title: e.title,
          client_display_name: clientName,
          // Use the most recent client upload as the "fresh"
          // timestamp; falls back to sent_at if nothing has uploaded.
          timestamp: lastUploadAt ?? e.sent_at ?? new Date().toISOString(),
          href: `/engagements/${e.id}`,
        });
      } else if (lastUploadAt && lastUploadAt >= recentSinceISO) {
        // Set isn't complete yet, but the client uploaded something
        // recently — surface that progress so the feed shows movement as
        // documents trickle in, not only when everything is finally in.
        // One row per engagement at its newest upload; naturally replaced
        // by ready_to_review above once the collection completes.
        out.push({
          id: `upload:${e.id}`,
          kind: "document_uploaded",
          engagement_title: e.title,
          client_display_name: clientName,
          timestamp: lastUploadAt,
          href: `/engagements/${e.id}`,
        });
      }
      if (attention.reasons.includes("overdue")) {
        out.push({
          id: `overdue:${e.id}`,
          kind: "overdue",
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
  const seen = new Set<string>();
  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const deduped: HomeNotification[] = [];
  for (const n of out) {
    const key = `${n.kind}:${n.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(n);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
