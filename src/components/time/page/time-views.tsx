"use client";

// The three ways of looking at the same entries: seven columns, one timeline,
// or a month grid.
//
// One file because they share every prop and differ only in arrangement — and
// because the three must agree about what a day total is. Split across three
// files, "does this total include the running timer" becomes three answers.

import { cn } from "@/lib/cn";
import { formatDayTotal, totalMinutes, type TimeCard } from "@/lib/time/time-page";
import { EmptyDayHint, RunningTimerCard, TimeEntryCard } from "./time-cards";
import { formatRunning } from "./running-clock";

export type ViewLabels = {
  duration: string;
  noClient: string;
  running: string;
  stop: string;
  logTime: string;
  today: string;
};

type Shared = {
  byDay: Map<string, TimeCard[]>;
  today: string;
  locale: string;
  elapsedSeconds: number;
  stopping: boolean;
  onStop: () => void;
  onEditDuration: (id: string, minutes: number) => Promise<boolean>;
  onLogTime: (day: string) => void;
  labels: ViewLabels;
  animate: boolean;
};

/** A day's total, INCLUDING the running timer's live seconds when it is that
 *  day's timer. One helper so the column header, the timeline header and the
 *  month cell cannot disagree. */
function dayTotal(cards: TimeCard[], elapsedSeconds: number): number {
  return totalMinutes(cards, undefined, elapsedSeconds);
}

const dayName = (day: string, locale: string, opts: Intl.DateTimeFormatOptions) =>
  // noon, so a timezone shift cannot roll the label onto the day either side.
  new Date(day + "T12:00:00").toLocaleDateString(
    locale === "fr" ? "fr-CA" : "en-CA",
    opts,
  );

// ── WEEK ───────────────────────────────────────────────────────────────────

export function TimeWeekGrid({
  days,
  ...s
}: Shared & { days: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-7">
      {days.map((day, i) => {
        const cards = s.byDay.get(day) ?? [];
        const isToday = day === s.today;
        const total = dayTotal(cards, s.elapsedSeconds);
        return (
          <div
            key={day}
            style={s.animate ? { animationDelay: `${i * 40}ms` } : undefined}
            className={cn(
              "rounded-xl border",
              isToday ? "border-accent/40 bg-accent/[0.03]" : "border-border bg-background",
              s.animate && "time-card-in",
            )}
          >
            <div className="px-3 pb-2 pt-2.5">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-[13px] font-semibold",
                    isToday && "text-accent",
                  )}
                >
                  {dayName(day, s.locale, { weekday: "short" })}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {dayName(day, s.locale, { month: "short", day: "numeric" })}
                </span>
                {isToday && (
                  <span className="ml-auto text-[10px] font-semibold uppercase text-accent">
                    {s.labels.today}
                  </span>
                )}
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatDayTotal(total)}
              </p>
            </div>

            <div className="flex flex-col gap-[7px] px-2.5 pb-2.5">
              {cards.map((c) =>
                c.running ? (
                  <RunningTimerCard
                    key={c.id}
                    card={c}
                    elapsedSeconds={s.elapsedSeconds}
                    onStop={s.onStop}
                    stopping={s.stopping}
                    labels={s.labels}
                  />
                ) : (
                  <TimeEntryCard
                    key={c.id}
                    card={c}
                    onEditDuration={s.onEditDuration}
                    labels={s.labels}
                  />
                ),
              )}
              {cards.length === 0 && (
                <EmptyDayHint
                  onClick={() => s.onLogTime(day)}
                  label={s.labels.logTime}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── DAY ────────────────────────────────────────────────────────────────────

const HOUR_START = 8;   // 8 AM
const HOUR_END = 19;    // 7 PM
const HOUR_PX = 52;

export function TimeDayTimeline({ day, ...s }: Shared & { day: string }) {
  const cards = s.byDay.get(day) ?? [];
  const total = dayTotal(cards, s.elapsedSeconds);
  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background px-[18px] pb-5 pt-4",
        s.animate && "time-card-in",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {dayName(day, s.locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h2>
        {day === s.today && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground">
            {s.labels.today}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatDayTotal(total)}
        </span>
      </div>

      <div
        className="relative"
        style={{ height: (HOUR_END - HOUR_START + 1) * HOUR_PX }}
      >
        {hours.map((h, i) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-border/60"
            style={{ top: i * HOUR_PX }}
          >
            {/* The label sits ON the line, masked by the page colour, so the
                rule reads as one continuous hour mark rather than two stubs. */}
            <span className="absolute -top-[7px] left-0 bg-background pr-2 text-[10.5px] tabular-nums text-muted-foreground">
              {h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}
            </span>
          </div>
        ))}

        {cards.map((c) => {
          // An entry with no clock time (a manual log lands at noon) still has
          // to appear. It is placed at its start if it has one, and at the top
          // of the timeline if it does not — never dropped.
          const startMin = c.startMinute ?? HOUR_START * 60;
          const top = ((startMin - HOUR_START * 60) / 60) * HOUR_PX;
          const liveMinutes = c.running
            ? c.minutes + s.elapsedSeconds / 60
            : c.minutes;
          const height = Math.max(30, (liveMinutes / 60) * HOUR_PX);
          return (
            <div
              key={c.id}
              className={cn(
                "absolute overflow-hidden rounded-lg border px-2.5 py-[5px]",
                c.running
                  ? "border-accent/45 bg-accent/[0.06]"
                  : "border-border bg-card",
              )}
              style={{
                left: 64,
                right: 8,
                top: Math.max(0, top),
                height,
                borderLeftWidth: 3,
                borderLeftColor: "var(--accent)",
              }}
            >
              <p className="truncate text-[12.5px] font-medium">
                {c.clientName ?? s.labels.noClient}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.running ? formatRunning(s.elapsedSeconds) : c.task}
              </p>
              {c.running && (
                <button
                  type="button"
                  onClick={s.onStop}
                  disabled={s.stopping}
                  className="mt-1 inline-flex h-5 items-center rounded bg-accent px-1.5 text-[10px] font-medium text-accent-foreground disabled:opacity-60"
                >
                  {s.labels.stop}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MONTH ──────────────────────────────────────────────────────────────────

export function TimeMonthGrid({
  cells,
  monthOf,
  ...s
}: Shared & { cells: string[]; monthOf: string }) {
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        s.animate && "time-card-in",
      )}
    >
      <div className="grid grid-cols-7">
        {dows.map((d) => (
          <div
            key={d}
            className="border-l border-border/60 px-2.5 py-2 text-[10.5px] font-semibold uppercase text-muted-foreground first:border-l-0"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const cards = s.byDay.get(day) ?? [];
          const total = dayTotal(cards, s.elapsedSeconds);
          const outside = day.slice(0, 7) !== monthOf.slice(0, 7);
          const isToday = day === s.today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => s.onLogTime(day)}
              className={cn(
                "relative min-h-[86px] border-l border-t border-border/60 px-2.5 py-2 text-left transition-colors first:border-l-0 hover:bg-muted/40",
                outside && "bg-secondary/50",
              )}
            >
              {isToday && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-[1.5px] rounded-md ring-[1.5px] ring-inset ring-accent"
                />
              )}
              <span
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  outside
                    ? "text-muted-foreground/50"
                    : isToday
                      ? "text-accent"
                      : "text-foreground",
                )}
              >
                {Number(day.slice(8))}
              </span>
              {total > 0 && (
                <span className="mt-1 block text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                  {formatDayTotal(total)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
