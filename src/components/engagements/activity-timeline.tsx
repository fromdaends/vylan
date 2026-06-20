import { getTranslations } from "next-intl/server";
import type { ActivityEntry } from "@/lib/db/activity";
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

  // The classifier writes one `ai_classified` row for every upload as a
  // raw debug breadcrumb (document_type + confidence). It's noise in the
  // user-facing timeline — the downstream verdict events
  // (ai_auto_rejected / ai_quality_flagged / ai_escalated_to_accountant)
  // are what the accountant actually cares about. Hide classifier rows
  // here; the audit log at /settings/audit still shows them for the
  // compliance trail.
  const visible = entries.filter((e) => e.action !== "ai_classified");

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {t("title")}
      </h2>
      <div>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
        ) : (
          <ol className="space-y-4 text-sm">
            {visible.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <span
                  className={
                    "mt-1.5 size-2 rounded-full shrink-0 ring-2 ring-background " +
                    actorDot(e.actor_type)
                  }
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="leading-snug text-foreground">
                    {describe(e, t, filenamesByFileId, rejectionReasonsByItemId)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <span className="font-medium">
                      {actorLabel(e.actor_type, t)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{formatRelative(e.created_at, locale)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function actorDot(actor: ActivityEntry["actor_type"]): string {
  if (actor === "client") return "bg-success";
  if (actor === "user") return "bg-primary";
  // System / Vylan events get a quiet muted dot so client + manual
  // actions read as the events the accountant actually drove or
  // received, while AI/system housekeeping recedes.
  return "bg-muted-foreground/50";
}

function actorLabel(
  actor: ActivityEntry["actor_type"],
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
): string {
  if (actor === "client") return t("actor_client");
  if (actor === "user") return t("actor_user");
  return t("actor_system");
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
    case "delete_file":
      // Deliberately no filename: the file row is erased, and the log keeps
      // no PII (see the Phase 5 rule on client_uploaded).
      return t("delete_file");
    case "add_item":
      return t("add_item", { label: meta.label ?? "—" });
    case "remove_item":
      return t("remove_item");
    case "manual_reminder":
      return t("manual_reminder");
    case "reminder_fired":
      return t("reminder_fired", { tone: toneLabel(meta.tone, t) });
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
    case "payment_requested":
      return t("payment_requested");
    case "client_paid":
      return t("client_paid");
    case "payment_failed":
      return t("payment_failed");
    case "signature_requested":
      return t("signature_requested", { label: meta.label ?? "—" });
    case "signature_signed":
      return t("signature_signed");
    case "ai_classified":
      // Filtered out above, but keep the branch so the switch stays
      // exhaustive against future enum additions.
      return t("ai_classified", {
        document_type: String(meta.document_type ?? "—"),
      });
    case "ai_auto_rejected":
      return t("ai_auto_rejected", {
        issue: issueLabel(meta.primary_issue, t),
      });
    case "ai_escalated_to_accountant":
      return t("ai_escalated_to_accountant", {
        issue: issueLabel(meta.primary_issue, t),
      });
    case "ai_quality_flagged":
      return t("ai_quality_flagged", {
        issue: issueLabel(meta.primary_issue, t),
      });
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

// The classifier writes `primary_issue` as a snake_case enum
// (see src/lib/ai/usability.ts). Map each value through a translation
// so the timeline reads "wrong document type" instead of
// "wrong_document_type". Unknown values fall back to the raw string
// with underscores swapped for spaces so the row never breaks.
const KNOWN_ISSUES: Record<string, string> = {
  text_unreadable: "issue_text_unreadable",
  key_fields_obscured: "issue_key_fields_obscured",
  partial_capture: "issue_partial_capture",
  glare_or_shadow: "issue_glare_or_shadow",
  wrong_document_type: "issue_wrong_document_type",
  corrupt_or_blank: "issue_corrupt_or_blank",
  other: "issue_other",
};

function issueLabel(
  raw: unknown,
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
): string {
  if (typeof raw !== "string" || !raw) return "—";
  const key = KNOWN_ISSUES[raw];
  if (key) {
    // next-intl t() signature is (key, values) — we know these keys
    // exist statically so the cast is safe.
    return t(key as Parameters<typeof t>[0]);
  }
  return raw.replace(/_/g, " ");
}

// `tone` is one of "gentle" | "firm" | "overdue" (see reminders.ts).
// Translate each; fall back to the raw string for safety on any future
// tone we haven't added a label for yet.
const KNOWN_TONES: Record<string, string> = {
  gentle: "tone_gentle",
  firm: "tone_firm",
  overdue: "tone_overdue",
};

function toneLabel(
  raw: unknown,
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
): string {
  if (typeof raw !== "string" || !raw) return "—";
  const key = KNOWN_TONES[raw];
  if (key) {
    return t(key as Parameters<typeof t>[0]);
  }
  return raw;
}
