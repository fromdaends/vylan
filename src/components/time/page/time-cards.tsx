"use client";

// The two things that sit in a day column: a finished entry, and the one that
// is still running.
//
// ── NO START BUTTON HERE, EVER ─────────────────────────────────────────────
//
// The running card can STOP a timer and nothing on this page can start one.
// That is doctrine, settled after timers sprouted on four different screens:
// one global timer, started from the launcher, or the firm ends up with three
// half-remembered clocks and no idea which one is the truth. Do not add a
// "start" affordance to this file.
//
// "+ Log time" is not a timer — it is the manual-entry flow, for work already
// done.

import { Clock, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRunning } from "./running-clock";
import { DurationEditor } from "./duration-editor";
import type { TimeCard } from "@/lib/time/time-page";

export function TimeEntryCard({
  card,
  onEditDuration,
  labels,
  delayMs,
}: {
  card: TimeCard;
  onEditDuration: (id: string, minutes: number) => Promise<boolean>;
  labels: { duration: string; noClient: string };
  delayMs?: number;
}) {
  return (
    <div
      style={delayMs == null ? undefined : { animationDelay: `${delayMs}ms` }}
      className={cn(
        "rounded-[10px] border border-border bg-card px-[11px] py-[9px]",
        "transition-[box-shadow,border-color] duration-150",
        "hover:border-border hover:shadow-[0_2px_8px_rgb(0_0_0_/_0.06)]",
        delayMs != null && "time-card-in",
      )}
    >
      <p className="truncate text-[12.5px] font-medium">
        {card.clientName ?? labels.noClient}
      </p>
      {card.task && (
        <p className="truncate text-[11.5px] text-muted-foreground">
          {card.task}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <DurationEditor
          minutes={card.minutes}
          label={labels.duration}
          onCommit={(m) => onEditDuration(card.id, m)}
        />
      </div>
    </div>
  );
}

export function RunningTimerCard({
  card,
  elapsedSeconds,
  onStop,
  stopping,
  labels,
}: {
  card: TimeCard;
  /** Ticked by the page, not by this card — one interval for the whole screen
   *  rather than one per card that happens to be running. */
  elapsedSeconds: number;
  onStop: () => void;
  stopping: boolean;
  labels: { running: string; stop: string; noClient: string };
}) {
  return (
    <div className="rounded-[10px] border border-accent/45 bg-accent/[0.05] px-[11px] py-[9px]">
      <div className="flex items-center gap-1.5">
        <Clock className="time-pulse size-3 text-accent" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          {labels.running}
        </span>
      </div>
      <p className="mt-1 truncate text-[12.5px] font-medium">
        {card.clientName ?? labels.noClient}
      </p>
      {card.task && (
        <p className="truncate text-[11.5px] text-muted-foreground">
          {card.task}
        </p>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold tabular-nums">
          {formatRunning(elapsedSeconds)}
        </span>
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          <Square className="size-2.5 fill-current" aria-hidden />
          {labels.stop}
        </button>
      </div>
    </div>
  );
}

/** The dashed prompt on a day with nothing logged. */
export function EmptyDayHint({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-[10px] border-[1.5px] border-dashed border-border px-2.5 py-3.5 text-center text-xs text-muted-foreground transition-colors duration-150 hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}
