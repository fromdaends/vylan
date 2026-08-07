// THE FLOW'S TIMELINE (rail box) — the engagement page's answer to "what did
// Vylan do, where is this job, what happens next". Renders the SAME journey
// the builder's Automation step promised — sent → accepted → stages →
// completed, same words, same i18n keys — but as history, from the
// exactly-once ledger. A failed automated send shows up here in red; before
// this card, a burned claim was invisible outside the database.
//
// Pure presenter: the page derives the timeline (buildFlowTimeline) and this
// only draws it. Server component, no interactivity — the one action a flow
// ever asks for (the confirm gate) already has its own card in the main
// column.

import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { formatDate, type AppLocale } from "@/lib/format";
import { RailBox } from "@/components/engagements/engagement-rail-box";
import { stageLabelKey } from "@/lib/engagements/stage";
import type {
  FiredAction,
  FlowTimeline,
} from "@/lib/workflow/timeline";

export async function WorkflowTimelineCard({
  timeline,
  locale,
  memberNames,
  style,
}: {
  timeline: FlowTimeline;
  locale: AppLocale;
  /** user id → display name, for "handed to X" lines. */
  memberNames: Record<string, string>;
  style?: React.CSSProperties;
}) {
  const t = await getTranslations("Automations");
  const tStage = await getTranslations("Stage");

  const date = (iso: string | null) =>
    iso ? (
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDate(iso, locale, "medium")}
      </span>
    ) : null;

  // One sub-line per fired action, in plain words. Null = say nothing (an
  // "assign skipped" is bookkeeping, not news).
  const firedLine = (f: FiredAction): { text: string; failed: boolean } | null => {
    if (f.action === "activate_checklist" && f.status === "done") {
      return { text: t("timeline_checklist_on"), failed: false };
    }
    if (f.action === "send_invoice") {
      if (f.status === "done") {
        return { text: t("timeline_invoice_sent"), failed: false };
      }
      if (f.status === "skipped" && f.reason === "already_sent") {
        return { text: t("timeline_invoice_already"), failed: false };
      }
      return { text: t("timeline_invoice_failed"), failed: true };
    }
    if (f.action === "materialize_tasks") {
      if (f.status === "done") {
        return {
          text: t("timeline_tasks_created", { count: f.count ?? 0 }),
          failed: false,
        };
      }
      return { text: t("timeline_tasks_failed"), failed: true };
    }
    if (f.action === "assign" && f.status === "done") {
      const name = f.userId ? memberNames[f.userId] : undefined;
      return name
        ? { text: t("timeline_handed_to", { name }), failed: false }
        : null;
    }
    if (f.action === "notify_assignee" && f.status === "done") {
      return { text: t("timeline_notified"), failed: false };
    }
    if (f.status === "failed") {
      // An action this build doesn't know (newer deployment wrote it) still
      // failed — say so rather than hide it.
      return { text: t("timeline_action_failed"), failed: true };
    }
    return null;
  };

  const letterLine = (): { text: string; failed: boolean } | null => {
    const l = timeline.letter;
    if (!l) return null;
    if (l.status === "done") {
      return { text: t("timeline_letter_sent"), failed: false };
    }
    if (l.status === "planned") {
      return { text: t("timeline_letter_planned"), failed: false };
    }
    if (l.status === "skipped") {
      if (l.reason === "already_signed") {
        return { text: t("timeline_letter_already_signed"), failed: false };
      }
      if (l.reason === "already_sent") {
        return { text: t("timeline_letter_already_out"), failed: false };
      }
      if (l.reason === "no_service") {
        return { text: t("timeline_letter_no_service"), failed: false };
      }
      // not_configured — a setup gap the founder can fix, not a crash.
      return { text: t("timeline_letter_missing"), failed: true };
    }
    return { text: t("timeline_letter_failed"), failed: true };
  };

  const dot = (state: "done" | "current" | "upcoming" | "failed") => (
    <span
      aria-hidden
      className={cn(
        "absolute left-0 top-[5px] size-[11px] rounded-full border-2",
        state === "done" && "border-accent bg-accent",
        state === "current" && "border-accent bg-card",
        state === "upcoming" && "border-border bg-card",
        state === "failed" && "border-destructive bg-destructive",
      )}
    />
  );

  const titleClass = (muted: boolean) =>
    cn(
      "min-w-0 flex-1 truncate text-[13px] font-medium",
      muted && "font-normal text-muted-foreground",
    );

  const sub = (line: { text: string; failed: boolean } | null) =>
    line ? (
      <p
        className={cn(
          "mt-0.5 text-xs",
          line.failed ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {line.text}
      </p>
    ) : null;

  const letter = letterLine();

  return (
    <RailBox title={t("timeline_title")} className="animate-card-in" style={style}>
      <ol className="relative mt-3 flex flex-col gap-[13px]">
        {/* The spine. */}
        <div
          aria-hidden
          className="absolute bottom-2 left-[5px] top-2 w-px bg-border/60"
        />

        {/* Sent — where the journey (and the letter) actually starts. */}
        <li className="relative pl-5">
          {dot(
            letter?.failed
              ? "failed"
              : timeline.sent.state === "done"
                ? "done"
                : "upcoming",
          )}
          <div className="flex items-baseline gap-2.5">
            <span className={titleClass(timeline.sent.state !== "done")}>
              {t("plan_sent_title")}
            </span>
            {date(timeline.sent.at)}
          </div>
          {sub(letter)}
        </li>

        {/* Acceptance — only when this engagement holds for one. */}
        {timeline.acceptance && (
          <li className="relative pl-5">
            {dot(timeline.acceptance.state === "done" ? "done" : "upcoming")}
            <div className="flex items-baseline gap-2.5">
              <span
                className={titleClass(timeline.acceptance.state !== "done")}
              >
                {t("plan_accept_title")}
              </span>
              {date(timeline.acceptance.at)}
            </div>
            {timeline.acceptance.state === "waiting" &&
              sub({ text: t("timeline_waiting_client"), failed: false })}
          </li>
        )}

        {/* The working stages, plan × ledger. */}
        {timeline.stages.map((row) => {
          const hasFailure = row.fired.some((f) => f.status === "failed");
          const isCompleted = row.line.stage === "completed";
          return (
            <li key={row.line.stage} className="relative pl-5">
              {dot(
                hasFailure
                  ? "failed"
                  : row.state === "passed" ||
                      (isCompleted && row.state === "current")
                    ? "done"
                    : row.state,
              )}
              <div className="flex items-baseline gap-2.5">
                <span
                  className={cn(
                    titleClass(row.state === "upcoming"),
                    row.state === "current" && "text-accent",
                  )}
                >
                  {tStage(stageLabelKey(row.line.stage))}
                </span>
                {/* A regressed stage (entered once, now ahead of us again)
                    keeps its fired history below but not the date — an
                    upcoming row wearing a timestamp reads as done. */}
                {row.state !== "upcoming" && date(row.enteredAt)}
              </div>
              {row.fired.map((f, i) => (
                <span key={i}>{sub(firedLine(f))}</span>
              ))}
              {/* Same words as the gate card in the main column — one
                  concept, one key (Stage.gate_waiting), per the cohesion
                  rule. */}
              {row.state === "current" && row.gateWaiting && (
                <p className="mt-0.5 text-xs font-medium text-accent">
                  {tStage("gate_waiting")}
                </p>
              )}
              {row.state === "current" &&
                !row.gateWaiting &&
                row.line.advance && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("advance_label")}{" "}
                    {t(`condition_${row.line.advance.condition}`)} ·{" "}
                    {t(
                      row.line.advance.mode === "confirm"
                        ? "mode_confirm"
                        : "mode_automatic",
                    )}
                  </p>
                )}
              {/* Always stated, even while upcoming — the founder had to ask
                  whether paid means done; the answer belongs on the page. */}
              {isCompleted && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("plan_completed_note")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </RailBox>
  );
}
