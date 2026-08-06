"use client";

// One job, as a card on the capacity board.
//
// ── THE PILL IS DERIVED, NEVER SET ─────────────────────────────────────────
//
// The session that shipped the workflow engine left a note for this one, and it
// is the most important rule on this file: the card's status must be COMPUTED
// from what the engine knows, never stored on the card and never chosen by
// hand. Their words: otherwise "the board lies within a week" — the same
// disease that killed the old stage labels.
//
// So the pill renders `row.derivedStatus`, which is what the worklist table and
// the client portal already render (lib/attention's deriveEngagementStatus).
// One vocabulary, three surfaces, no way for the board to disagree with the
// list about what is happening to a job.
//
// ── HOURS ARE THE POINT ────────────────────────────────────────────────────
//
// Budget / Actual / Remaining across the footer is what makes this a CAPACITY
// board rather than a prettier kanban. Budget comes from the services on the
// job (resolveBudgetMinutes), actual is summed from real time entries, and a
// NEGATIVE remaining is shown in red rather than clamped — an overrun is
// precisely the thing you opened this screen to find.
//
// An unbudgeted job reads "—", never "0h". See board-stats.ts.

import { StatusCapsule } from "@/components/ui/status-capsule";
import { statusTone } from "@/lib/engagements/status-tone";
import { cn } from "@/lib/cn";
import { formatDate, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/engagements/board-stats";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

export type BoardCardData = {
  row: WorklistRow;
  budgetMinutes: number | null;
  actualMinutes: number;
  boardRank: number | null;
};

/** Two letters from the client's name, for the corner avatar. */
export function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function BoardCard({
  data,
  locale,
  today,
  showBudget,
  labels,
  statusLabel,
  onPointerDown,
  dragging = false,
  entranceDelayMs,
}: {
  data: BoardCardData;
  locale: AppLocale;
  /** Firm-day, passed in — never `new Date()` in a component that renders on
   *  both sides of the wire. */
  today: string;
  /** The board preference. Off hides the hours footer entirely. */
  showBudget: boolean;
  labels: {
    budget: string;
    actual: string;
    remaining: string;
    noDueDate: string;
    overdue: string;
    docs: string;
    tasks: string;
  };
  /** The status word itself, already localized by the caller — a card does not
   *  get its own translator for a vocabulary three surfaces share. */
  statusLabel: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** The card being carried. Kept in the DOM but hidden, so the column keeps
   *  its scroll height while the ghost is out. */
  dragging?: boolean;
  /** Staggered first-load entrance. Undefined = no animation (a re-render, or
   *  reduced motion). */
  entranceDelayMs?: number;
}) {
  const { row } = data;
  const overdue =
    row.dueDate != null && row.dueDate < today && row.status !== "complete";

  const remainingMinutes =
    data.budgetMinutes == null ? null : data.budgetMinutes - data.actualMinutes;

  // The docs bar. Documents, not tasks — the two counts sit on the same line
  // below it and the bar tracks the one the client is responsible for.
  const docsPct =
    row.itemsTotal > 0
      ? Math.min(100, Math.round((row.itemsDone / row.itemsTotal) * 100))
      : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      style={
        entranceDelayMs == null
          ? undefined
          : { animationDelay: `${entranceDelayMs}ms` }
      }
      className={cn(
        "group cursor-grab rounded-xl border border-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgb(0_0_0_/_0.05)]",
        "transition-[transform,box-shadow,border-color] duration-[180ms]",
        "hover:-translate-y-px hover:border-border hover:shadow-[0_6px_16px_rgb(0_0_0_/_0.10)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        entranceDelayMs != null && "board-card-in",
        // Hidden, not unmounted: removing it would collapse the column's
        // height mid-drag and make every drop target move under the pointer.
        dragging && "invisible",
      )}
    >
      {/* Client + initials */}
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {row.clientName}
        </p>
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[8.5px] font-semibold text-foreground/70"
        >
          {clientInitials(row.clientName)}
        </span>
      </div>

      <p className="mt-0.5 text-sm font-medium leading-[1.35]">{row.title}</p>

      <div className="mt-[9px] flex items-center justify-between gap-2">
        {/* The SAME capsule the table and the portal render, wearing the ONE
            shared tone mapping rather than a ternary of its own — in the
            board's FILLED variant, which is the tinted pill the approved
            design shows ("In progress" reads blue, not a blue dot on white). */}
        <StatusCapsule variant="filled" tone={statusTone(row.derivedStatus)}>
          {statusLabel}
        </StatusCapsule>
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {row.dueDate == null
            ? labels.noDueDate
            : overdue
              ? `${formatDate(row.dueDate, locale)} · ${labels.overdue}`
              : formatDate(row.dueDate, locale)}
        </span>
      </div>

      {/* Documents progress. Coloured by overdue, because a bar that is on
          track and a bar that is late should not look the same. */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-sm bg-secondary">
        <div
          className={cn(
            "h-full rounded-sm transition-[width] duration-[400ms]",
            overdue ? "bg-destructive" : "bg-accent",
          )}
          style={{ width: `${docsPct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
        {row.itemsDone}/{row.itemsTotal} {labels.docs} · {row.tasksDone}/
        {row.tasksTotal} {labels.tasks}
      </p>

      {showBudget && (
        <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5">
          <Cell label={labels.budget} value={formatMinutes(data.budgetMinutes)} />
          <Cell label={labels.actual} value={formatMinutes(data.actualMinutes)} />
          <Cell
            label={labels.remaining}
            value={formatMinutes(remainingMinutes)}
            // Over budget. Red, not clamped — this is the number the board is
            // for.
            danger={remainingMinutes != null && remainingMinutes < 0}
          />
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-[12.5px] font-medium tabular-nums",
          danger && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
