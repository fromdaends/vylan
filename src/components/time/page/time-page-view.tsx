"use client";

// The Time page.
//
// ── HOURS ONLY ─────────────────────────────────────────────────────────────
//
// The handoff is emphatic and this file honours it: no dollar values, no
// billable badges, no invoice actions, no capacity bars. Rates exist in this
// product and are permission-gated; a page whose whole job is "where did my
// week go" does not need them, and putting them here would drag that gate onto
// a screen every member opens.
//
// ── ONE TICK FOR THE WHOLE PAGE ────────────────────────────────────────────
//
// The running timer's seconds live here, not in the card. A card that owned its
// own interval would keep ticking in a collapsed month cell, and the week total
// would be a second out of step with the card it came from.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  daysForView,
  formatDayTotal,
  groupByDay,
  shiftAnchor,
  startOfMonth,
  totalMinutes,
  type TimeCard,
  type TimeView,
} from "@/lib/time/time-page";
import { stopTimerAction, updateTimeEntryAction } from "@/app/actions/time-entries";
// The EXISTING manual-entry flow, opened in place. `mode="manual"` logs a
// finished entry; this page must never open it as "timer" — one global timer,
// started from the launcher, is doctrine.
import { StartSheet } from "@/components/time/start-sheet";
import { TimeDayTimeline, TimeMonthGrid, TimeWeekGrid } from "./time-views";

export function TimePageView({
  cards: serverCards,
  anchor,
  view,
  today,
  locale,
  personName,
}: {
  cards: TimeCard[];
  anchor: string;
  view: TimeView;
  today: string;
  locale: string;
  personName: string;
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  // "+ Log time" opens the real sheet HERE rather than navigating. It used to
  // push /work?log=1 — a query nothing reads, so the button went to another
  // page and did nothing. The founder's own rule: no buttons that don't work.
  const [logOpen, setLogOpen] = useState(false);
  const [logKey, setLogKey] = useState(0);
  const openLog = useCallback(() => {
    setLogKey((k) => k + 1);
    setLogOpen(true);
  }, []);
  // Optimistic duration edits, keyed by entry id. Empty in the steady state.
  const [edited, setEdited] = useState<Record<string, number>>({});

  const cards = useMemo(
    () =>
      serverCards.map((c) =>
        edited[c.id] == null ? c : { ...c, minutes: edited[c.id] },
      ),
    [serverCards, edited],
  );

  // Fresh server data supersedes every optimistic guess.
  const [seen, setSeen] = useState(serverCards);
  if (seen !== serverCards) {
    setSeen(serverCards);
    setEdited({});
  }

  const running = cards.find((c) => c.running) ?? null;

  // ── THE TICK ────────────────────────────────────────────────────────────
  // DERIVED from started_at, never counted. An interval that increments a
  // number loses every tick the tab was asleep for, so a laptop shut at 2pm and
  // opened at 4pm would show two minutes instead of two hours. The interval
  // exists only to re-ask "what time is it".
  const startedMs = running?.startedAtIso
    ? Date.parse(running.startedAtIso)
    : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (startedMs == null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  const elapsed =
    startedMs == null ? 0 : Math.max(0, Math.floor((nowMs - startedMs) / 1000));

  const days = useMemo(() => daysForView(view, anchor), [view, anchor]);
  const dayset = useMemo(() => new Set(days), [days]);
  const byDay = useMemo(() => groupByDay(cards), [cards]);
  const rangeTotal = totalMinutes(cards, dayset, elapsed);

  const go = (next: Partial<{ view: TimeView; anchor: string }>) => {
    const params = new URLSearchParams({
      view: next.view ?? view,
      date: next.anchor ?? anchor,
    });
    router.push(`/time?${params}`);
  };

  const editDuration = useCallback(
    async (id: string, minutes: number) => {
      setEdited((e) => ({ ...e, [id]: minutes }));
      const res = await updateTimeEntryAction({
        entryId: id,
        durationMinutes: minutes,
      });
      if (!res.ok) {
        setEdited((e) => {
          const next = { ...e };
          delete next[id];
          return next;
        });
        toast.error(t("edit_failed"));
        return false;
      }
      router.refresh();
      return true;
    },
    [router, t],
  );

  async function stop() {
    if (!running || stopping) return;
    setStopping(true);
    const res = await stopTimerAction({ entryId: running.id });
    setStopping(false);
    if (!res.ok) return toast.error(t("stop_failed"));
    router.refresh();
  }

  // First paint only; reduced motion is handled in globals.css.
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimate(false), 1200);
    return () => window.clearTimeout(id);
  }, []);

  const shared = {
    byDay,
    today,
    locale,
    elapsedSeconds: elapsed,
    stopping,
    onStop: stop,
    onEditDuration: editDuration,
    onLogTime: openLog,
    animate,
    labels: {
      duration: t("duration_label"),
      noClient: t("no_client"),
      running: t("timer_running"),
      stop: t("stop"),
      logTime: t("log_time"),
      today: t("today"),
    },
  };

  return (
    <div className="space-y-4">
      <header className={cn("flex flex-wrap items-center gap-2", animate && "time-card-in")}>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">
          {t("title")}
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-border px-2.5 text-[12.5px]">
            <span className="grid size-5 place-items-center rounded-full bg-accent text-[9px] font-semibold text-accent-foreground">
              {personName.slice(0, 1).toUpperCase()}
            </span>
            {t("person_you", { name: personName })}
          </span>

          <div className="flex overflow-hidden rounded-lg border border-border">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => go({ view: v })}
                aria-pressed={view === v}
                className={cn(
                  "h-8 px-3 text-[12.5px] transition-colors",
                  view === v
                    ? "bg-accent-subtle font-semibold text-accent"
                    : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`view_${v}` as "view_day")}
              </button>
            ))}
          </div>

          <div className="flex items-center overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => go({ anchor: shiftAnchor(view, anchor, -1) })}
              aria-label={t("previous")}
              className="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="px-2 text-[13px] font-medium tabular-nums">
              {rangeLabel(view, anchor, days, locale)}
            </span>
            <button
              type="button"
              onClick={() => go({ anchor: shiftAnchor(view, anchor, 1) })}
              aria-label={t("next")}
              className="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          <button
            type="button"
            onClick={openLog}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-accent-foreground shadow-[0_2px_6px_var(--accent-subtle)] transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-[15px]" aria-hidden />
            {t("log_time")}
          </button>
        </div>
      </header>

      <p className={cn("text-[13.5px] text-muted-foreground", animate && "time-card-in")}>
        {t(`total_${view}` as "total_week")}{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {formatDayTotal(rangeTotal)}
        </span>
      </p>

      {view === "week" && <TimeWeekGrid days={days} {...shared} />}
      {view === "day" && <TimeDayTimeline day={anchor} {...shared} />}
      {view === "month" && (
        <TimeMonthGrid cells={days} monthOf={startOfMonth(anchor)} {...shared} />
      )}

      <StartSheet
        open={logOpen}
        instanceKey={logKey}
        mode="manual"
        prefill={null}
        // A running timer is the sheet's business only when STARTING one. This
        // page logs finished work, so there is nothing to ask about saving.
        runningEntryId={null}
        runningLabel={null}
        onClose={() => setLogOpen(false)}
        onStarted={() => {
          setLogOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

/** The date-nav label follows the active view, per the handoff: a day, a span,
 *  or a month. */
function rangeLabel(
  view: TimeView,
  anchor: string,
  days: string[],
  locale: string,
): string {
  const l = locale === "fr" ? "fr-CA" : "en-CA";
  const at = (day: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(day + "T12:00:00").toLocaleDateString(l, opts);

  if (view === "day") {
    return at(anchor, { weekday: "short", month: "short", day: "numeric" });
  }
  if (view === "week") {
    return `${at(days[0], { month: "short", day: "numeric" })} – ${at(days[6], { month: "short", day: "numeric" })}`;
  }
  return at(anchor, { month: "long", year: "numeric" });
}
