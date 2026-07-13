"use client";

import { useTranslations } from "next-intl";
import { formatRelative, type AppLocale } from "@/lib/format";

// The slim activity shape the timeline renders. Structurally a subset of
// ActivityEntry (src/lib/db/activity.ts) so server code can pass DB rows
// straight through; the Assistant panel's Activity tab receives the same
// shape as JSON from GET /api/engagement-chat/activity.
export type TimelineEntry = {
  id: string;
  actor_type: "user" | "client" | "system";
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Client component since the panel's Activity tab (a client surface) renders
// it. Formerly an async server component — the conversion only swapped
// getTranslations for useTranslations and the two Map props for plain
// JSON-friendly Records; every describe/actor/issue/tone rule is unchanged so
// events read byte-identically to the old slide-out.
export function ActivityTimeline({
  entries,
  locale,
  filenamesByFileId,
  rejectionReasonsByItemId,
}: {
  entries: TimelineEntry[];
  locale: AppLocale;
  // Live lookup of the current filename for an uploaded_files row. The
  // activity row only stores `file_id` (Phase 5) so the timeline reads
  // the filename from the parent record at render time. If the file is
  // deleted, the filename is too — that's intentional, retention is
  // bound to the file's lifecycle rather than the 2-year audit log.
  filenamesByFileId?: Record<string, string>;
  // Same shape for the live rejection_reason of a request_item.
  rejectionReasonsByItemId?: Record<string, string | null>;
}) {
  const t = useTranslations("Activity");

  // The classifier writes one `ai_classified` row for every upload as a
  // raw debug breadcrumb (document_type + confidence). It's noise in the
  // user-facing timeline — the downstream verdict events
  // (ai_auto_rejected / ai_quality_flagged / ai_escalated_to_accountant)
  // are what the accountant actually cares about. Hide classifier rows
  // here; the audit log at /settings/audit still shows them for the
  // compliance trail.
  const visible = entries.filter((e) => e.action !== "ai_classified");

  return (
    <div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
      ) : (
        <ol className="space-y-4 text-sm">
          {visible.map((e) => (
            <li key={e.id} className="flex items-start gap-3">
              <span
                // ring-card, not ring-background: the timeline now renders on
                // the Assistant panel's bg-card surface, and the old
                // background-colored halo reads as a dark ring there in dark
                // mode.
                className={
                  "mt-1.5 size-2 rounded-full shrink-0 ring-2 ring-card " +
                  actorDot(e.actor_type)
                }
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="leading-snug text-foreground">
                  {describe(e, t, filenamesByFileId, rejectionReasonsByItemId)}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">
                    {actorLabel(e.actor_type, t)}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatRelative(e.created_at, locale)}</span>
                  {/* Proposed by the assistant, confirmed by a human — the
                      "AI assists, accountant decides" audit marker. */}
                  {e.metadata?.via === "assistant" && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-accent/90">
                        {t("via_assistant")}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<"Activity">>;

function actorDot(actor: TimelineEntry["actor_type"]): string {
  if (actor === "client") return "bg-success";
  if (actor === "user") return "bg-primary";
  // System / Vylan events get a quiet muted dot so client + manual
  // actions read as the events the accountant actually drove or
  // received, while AI/system housekeeping recedes.
  return "bg-muted-foreground/50";
}

function actorLabel(actor: TimelineEntry["actor_type"], t: Translator): string {
  if (actor === "client") return t("actor_client");
  if (actor === "user") return t("actor_user");
  return t("actor_system");
}

function describe(
  entry: TimelineEntry,
  t: Translator,
  filenamesByFileId?: Record<string, string>,
  rejectionReasonsByItemId?: Record<string, string | null>,
): string {
  const meta = entry.metadata as Record<string, string | undefined>;
  switch (entry.action) {
    case "client_uploaded": {
      // Prefer the live filename via file_id (new Phase 5 shape).
      // Fall back to legacy `meta.filename` for rows written before
      // Phase 5 / before the 0069 backfill ran. After backfill, both
      // are absent for old rows → display "—".
      const live = meta.file_id ? filenamesByFileId?.[meta.file_id] : undefined;
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
        ? rejectionReasonsByItemId?.[meta.item_id]
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
    case "item_updated":
      return t("item_updated");
    case "due_date_changed":
      return meta.to
        ? t("due_date_changed", { to: meta.to })
        : t("due_date_cleared");
    case "engagement_reassigned":
      return t("engagement_reassigned");
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
    case "final_document_uploaded":
      return t("final_document_uploaded", { filename: meta.filename ?? "—" });
    case "final_document_removed":
      return t("final_document_removed");
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

function issueLabel(raw: unknown, t: Translator): string {
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

function toneLabel(raw: unknown, t: Translator): string {
  if (typeof raw !== "string" || !raw) return "—";
  const key = KNOWN_TONES[raw];
  if (key) {
    return t(key as Parameters<typeof t>[0]);
  }
  return raw;
}
