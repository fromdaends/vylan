import { getTranslations } from "next-intl/server";
import type { ActivityEntry } from "@/lib/db/activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative, type AppLocale } from "@/lib/format";

export async function ActivityTimeline({
  entries,
  locale,
  filenamesByFileId,
  rejectionReasonsByItemId,
}: {
  entries: ActivityEntry[];
  locale: AppLocale;
  // Live lookup of the current filename for an uploaded_files row. The
  // activity row only stores `file_id` (Phase 5) so the timeline reads
  // the filename from the parent record at render time. If the file is
  // deleted, the filename is too — that's intentional, retention is
  // bound to the file's lifecycle rather than the 2-year audit log.
  filenamesByFileId?: Map<string, string>;
  // Same shape for the live rejection_reason of a request_item.
  rejectionReasonsByItemId?: Map<string, string | null>;
}) {
  const t = await getTranslations("Activity");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
        ) : (
          <ol className="space-y-3 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span
                  className={
                    "mt-1.5 size-1.5 rounded-full shrink-0 " +
                    actorDot(e.actor_type)
                  }
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="leading-snug">
                    {describe(e, t, filenamesByFileId, rejectionReasonsByItemId)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatRelative(e.created_at, locale)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function actorDot(actor: ActivityEntry["actor_type"]): string {
  if (actor === "client") return "bg-success";
  if (actor === "user") return "bg-primary";
  return "bg-muted-foreground";
}

function describe(
  entry: ActivityEntry,
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
  filenamesByFileId?: Map<string, string>,
  rejectionReasonsByItemId?: Map<string, string | null>,
): string {
  const meta = entry.metadata as Record<string, string | undefined>;
  switch (entry.action) {
    case "client_uploaded": {
      // Prefer the live filename via file_id (new Phase 5 shape).
      // Fall back to legacy `meta.filename` for rows written before
      // Phase 5 / before the 0069 backfill ran. After backfill, both
      // are absent for old rows → display "—".
      const live = meta.file_id
        ? filenamesByFileId?.get(meta.file_id)
        : undefined;
      const filename = live ?? meta.filename ?? "—";
      return t("client_uploaded", { filename });
    }
    case "client_marked_na":
      return t("client_marked_na");
    case "client_undid_na":
      return t("client_undid_na");
    case "approve_item":
      return t("approve_item");
    case "reject_item": {
      // Same pattern: live rejection_reason from the request_items row,
      // legacy fallback during the transition window.
      const live = meta.item_id
        ? rejectionReasonsByItemId?.get(meta.item_id)
        : undefined;
      const reason = live ?? meta.reason ?? "—";
      return t("reject_item", { reason });
    }
    case "reopen_item":
      return t("reopen_item");
    case "add_item":
      return t("add_item", { label: meta.label ?? "—" });
    case "remove_item":
      return t("remove_item");
    case "manual_reminder":
      return t("manual_reminder");
    case "reminder_fired":
      return t("reminder_fired", { tone: meta.tone ?? "—" });
    case "reminders_paused":
      return t("reminders_paused");
    case "reminders_resumed":
      return t("reminders_resumed");
    case "cancel_engagement":
      return t("cancel_engagement");
    case "complete_engagement":
      return t("complete_engagement");
    case "reopen_engagement":
      return t("reopen_engagement");
    case "ai_classified": {
      const conf =
        typeof meta.confidence === "number"
          ? `${Math.round((meta.confidence as number) * 100)}%`
          : "—";
      return t("ai_classified", {
        document_type: String(meta.document_type ?? "?"),
        confidence: conf,
      });
    }
    case "ai_auto_rejected": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_auto_rejected", { issue, confidence: conf });
    }
    case "ai_escalated_to_accountant": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_escalated_to_accountant", { issue, confidence: conf });
    }
    case "ai_quality_flagged": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_quality_flagged", { issue, confidence: conf });
    }
    case "ai_rejection_overridden":
      return t("ai_rejection_overridden");
    case "client_retry_email_sent":
      return t("client_retry_email_sent");
    case "client_retry_sms_sent":
      return t("client_retry_sms_sent");
    default:
      return entry.action;
  }
}

function pct(v: unknown): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
}
