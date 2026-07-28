// The scheduled sweep behind engagement.due_soon / overdue / stalled.
//
// These three are the only v1 catalog events with no moment to hang off: they
// are not things that HAPPEN, they are states an engagement drifts into while
// nobody is looking. computeAttention() already decides all three (it powers
// the dashboard worklist), but nothing has ever turned that decision into an
// event — the old feed re-derived "overdue" on every page load and could never
// email anyone about it.
//
// Safety properties that make a firm-wide sweep safe to run on a schedule:
//
//   * The catalog marks all three `bundle: true` with a 24h bundle window, so
//     re-running produces at most ONE notification per engagement per day no
//     matter how often this fires. That is the dedupe — there is no separate
//     "last notified" column to keep in sync.
//   * Only live engagements (sent / in_progress) are considered.
//   * Every firm is processed independently; one firm's bad data cannot stop
//     the rest, because each is wrapped.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { computeAttention, type AttentionReason } from "@/lib/attention";
import type { Engagement } from "@/lib/db/engagements";
import type { RequestItem } from "@/lib/db/request-items";
import { notify } from "./notify";

// The attention reason -> catalog key map. Written out rather than derived:
// the reason is "stale" and the event is "engagement.stalled", and
// getNotificationEvent is an exact lookup, so a silent mismatch here would make
// the event vanish into notify()'s unknown_event branch with only a log line.
const REASON_TO_EVENT: Record<AttentionReason, string> = {
  overdue: "engagement.overdue",
  due_soon: "engagement.due_soon",
  stale: "engagement.stalled",
};

export type SweepResult = {
  firmsScanned: number;
  engagementsScanned: number;
  notified: number;
};

export async function sweepEngagementAttention(opts?: {
  now?: Date;
}): Promise<SweepResult> {
  const now = opts?.now ?? new Date();
  const sb = getServiceRoleSupabase();
  const result: SweepResult = {
    firmsScanned: 0,
    engagementsScanned: 0,
    notified: 0,
  };

  // Live engagements across every firm, in one read. A firm with none simply
  // never appears.
  const { data: engRows, error } = await sb
    .from("engagements")
    .select("*")
    .in("status", ["sent", "in_progress"]);
  if (error) {
    console.error("[attention-sweep] engagement read failed:", error);
    return result;
  }
  const engagements = (engRows ?? []) as Engagement[];
  if (engagements.length === 0) return result;

  const ids = engagements.map((e) => e.id);
  const [itemsResp, filesResp, clientsResp] = await Promise.all([
    sb.from("request_items").select("*").in("engagement_id", ids),
    sb
      .from("uploaded_files")
      .select("engagement_id, uploaded_at")
      .in("engagement_id", ids),
    sb
      .from("clients")
      .select("id, display_name")
      .in("id", Array.from(new Set(engagements.map((e) => e.client_id)))),
  ]);

  const itemsByEng = new Map<string, RequestItem[]>();
  for (const it of (itemsResp.data ?? []) as RequestItem[]) {
    const arr = itemsByEng.get(it.engagement_id);
    if (arr) arr.push(it);
    else itemsByEng.set(it.engagement_id, [it]);
  }

  const lastActivityByEng = new Map<string, string>();
  for (const f of (filesResp.data ?? []) as {
    engagement_id: string;
    uploaded_at: string;
  }[]) {
    const prev = lastActivityByEng.get(f.engagement_id);
    if (!prev || f.uploaded_at > prev) {
      lastActivityByEng.set(f.engagement_id, f.uploaded_at);
    }
  }

  const clientNames = new Map(
    ((clientsResp.data ?? []) as { id: string; display_name: string }[]).map(
      (c) => [c.id, c.display_name],
    ),
  );

  const firms = new Set<string>();
  for (const e of engagements) {
    firms.add(e.firm_id);
    result.engagementsScanned++;
    try {
      const attention = computeAttention({
        engagement: e,
        items: itemsByEng.get(e.id) ?? [],
        lastClientActivityAt: lastActivityByEng.get(e.id) ?? null,
        now,
      });

      for (const reason of attention.reasons) {
        const eventKey = REASON_TO_EVENT[reason];
        if (!eventKey) continue;
        const res = await notify({
          firmId: e.firm_id,
          eventKey,
          entity: { type: "engagement", id: e.id },
          engagementId: e.id,
          clientId: e.client_id,
          now,
          payload: {
            engagement_title: e.title,
            client_name: clientNames.get(e.client_id) ?? null,
            days_overdue: attention.daysOverdue,
            days_until_due: attention.daysUntilDue,
            days_since_activity: attention.daysSinceClientActivity,
            href: `/engagements/${e.id}`,
          },
        });
        // A bundled repeat is not a new notification — only count fresh ones so
        // the cron's log line means "people were actually told N things".
        result.notified += res.delivered;
      }
    } catch (err) {
      // One malformed engagement must never stop the sweep for everyone else.
      console.error(`[attention-sweep] engagement ${e.id} failed:`, err);
    }
  }

  result.firmsScanned = firms.size;
  return result;
}
