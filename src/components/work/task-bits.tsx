"use client";

// The pieces of a task row, shared by every list that draws one.
//
// InternalWork (the job page and /work) and the dashboard's grouped Tasks card
// are DIFFERENT layouts of the SAME row: a status checkbox, a title with a
// "who it's for" line, a due indicator, an assignee menu. Per the cohesion
// rule, the layouts may differ — the pieces may not, or "in progress" ends up
// one colour on one screen and another on the next. Behaviour lives here;
// the lists arrange it.

import { Check, Minus, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  bucketForDueDate,
  daysBetween,
  formatDueShort,
  formatDueWeekday,
  todayInTimeZone,
} from "@/lib/tasks/dates";

export type TaskStatus = "todo" | "doing" | "done";
export type Person = { id: string; name: string };

// todo → doing → done → todo. One click moves you along; three bring you back,
// which is the whole reason it is a cycle and not a toggle.
export const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

/** The three-state box. Exactly one drawing of it in the whole app. */
export function TaskStatusCheckbox({
  status,
  disabled,
  onCycle,
  ariaLabel,
  className,
}: {
  status: TaskStatus;
  disabled?: boolean;
  onCycle: () => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCycle}
      aria-label={ariaLabel}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50",
        status === "done"
          ? "border-foreground bg-foreground text-background"
          : status === "doing"
            ? "border-foreground/60 text-foreground/70"
            : "border-border hover:border-foreground/50",
        className,
      )}
    >
      {status === "done" && <Check className="size-3.5" aria-hidden />}
      {status === "doing" && <Minus className="size-3.5" aria-hidden />}
    </button>
  );
}

/** "Client · Engagement", as links. The line that says who a task is for. */
export function TaskWhoFor({
  clientId,
  clientName,
  engagementId,
  engagementTitle,
  taskTitle,
  className,
}: {
  clientId: string;
  clientName?: string | null;
  engagementId?: string | null;
  engagementTitle?: string | null;
  /** When given, an engagement title that merely repeats it is skipped. 1380
   *  named each backfilled task after its own job, which is right on a job
   *  page and reads as a stutter in a list: "T2 Tax Return / ABC Inc · T2 Tax
   *  Return". The client is the part that varies; keep that. */
  taskTitle?: string;
  className?: string;
}) {
  const showEngagement =
    engagementId &&
    engagementTitle &&
    (taskTitle === undefined || engagementTitle !== taskTitle);
  return (
    <span
      className={cn(
        "block truncate text-xs text-muted-foreground",
        className,
      )}
    >
      <Link
        href={`/clients/${clientId}`}
        className="hover:text-foreground hover:underline"
      >
        {clientName ?? "—"}
      </Link>
      {showEngagement && (
        <>
          {" · "}
          <Link
            href={`/engagements/${engagementId}`}
            className="hover:text-foreground hover:underline"
          >
            {engagementTitle}
          </Link>
        </>
      )}
    </span>
  );
}

/**
 * The due date, drawn the way the approved dashboard design draws it:
 * overdue → a destructive pill ("Jul 30 · 4 days"); upcoming → quiet text
 * ("Wed, Aug 5"); due today → quiet accent text, or nothing where the group
 * header already says it (hideToday); no date → "No due date" only where a
 * list wants the silence filled (showEmpty). Done rows show nothing — the
 * strikethrough is the whole message.
 */
export function DueIndicator({
  dueDate,
  status,
  today,
  hideToday = false,
  showEmpty = false,
  className,
}: {
  dueDate: string | null | undefined;
  status: TaskStatus;
  /** YYYY-MM-DD in the firm's timezone. Falls back to the viewer's clock so
   *  lists that lack a firm context still label sensibly. */
  today?: string;
  hideToday?: boolean;
  showEmpty?: boolean;
  className?: string;
}) {
  const t = useTranslations("Engagements");
  const locale = useLocale();
  if (status === "done") return null;

  const ref =
    today ?? todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

  if (!dueDate) {
    if (!showEmpty) return null;
    return (
      <span className={cn("flex-none text-xs text-muted-foreground", className)}>
        {t("due_none")}
      </span>
    );
  }

  const bucket = bucketForDueDate(dueDate, ref);

  if (bucket === "overdue") {
    return (
      <span
        className={cn(
          "inline-flex flex-none items-center rounded-full bg-destructive/10 px-[9px] py-[3px] text-xs font-medium text-destructive",
          className,
        )}
      >
        {formatDueShort(dueDate, locale)}
        {" · "}
        {t("due_days_late", { count: daysBetween(dueDate, ref) })}
      </span>
    );
  }

  if (bucket === "today") {
    if (hideToday) return null;
    return (
      <span className={cn("flex-none text-xs font-medium text-accent", className)}>
        {t("due_today")}
      </span>
    );
  }

  return (
    <span className={cn("flex-none text-xs text-muted-foreground", className)}>
      {formatDueWeekday(dueDate, locale)}
    </span>
  );
}

/**
 * Who is on it — up to three faces, then "+n", opening a keep-open menu of the
 * firm's people. Unassigned shows the dashed invitation instead. One drawing,
 * both lists.
 */
export function TaskAssigneeMenu({
  assigneeIds,
  members,
  canEdit,
  onToggle,
  unassignedLabel,
  avatarSize = 18,
}: {
  assigneeIds: string[];
  members: Person[];
  canEdit: boolean;
  onToggle: (userId: string, on: boolean) => void;
  unassignedLabel: string;
  avatarSize?: number;
}) {
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const assignees = assigneeIds
    .map((id) => ({ id, name: nameById.get(id) }))
    .filter((a): a is Person => Boolean(a.name));

  if (!canEdit) {
    if (assignees.length === 0) return null;
    return (
      <span className="flex shrink-0 items-center gap-1">
        {assignees.slice(0, 3).map((a) => (
          <AvatarInitials key={a.id} name={a.name} size={avatarSize} />
        ))}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {assignees.length > 0 ? (
            <>
              {/* Faces, not names: two people on a task is the ordinary case
                  and two full names do not fit. */}
              {assignees.slice(0, 3).map((a) => (
                <AvatarInitials key={a.id} name={a.name} size={avatarSize} />
              ))}
              {assignees.length > 3 && (
                <span className="tabular-nums">+{assignees.length - 3}</span>
              )}
            </>
          ) : (
            <>
              <UserPlus className="size-3.5" aria-hidden />
              {unassignedLabel}
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {members.map((m) => {
          const on = assigneeIds.includes(m.id);
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={(e) => {
                // Keep the menu open: putting two people on a task should not
                // cost two trips to the same button.
                e.preventDefault();
                onToggle(m.id, !on);
              }}
              className="gap-2"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border",
                )}
              >
                {on && <Check className="size-3" aria-hidden />}
              </span>
              <AvatarInitials name={m.name} size={18} />
              {m.name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
