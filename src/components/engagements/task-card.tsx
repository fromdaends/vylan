"use client";

// A task as a BOX, for the engagement page.
//
// The founder, with Karbon's capacity board open as a reference: "I'm very fond
// of the like box look. What if we represent a task as like a box with the name
// and the relevant information to that task. I want to spice up the colour too
// and make it not feel boring."
//
// ── THE COLOUR IS THE STATUS, AND IT IS NOT DECORATION ────────────────────
//
// "You should make the color of the task align with the status of the task...
// so the colors can change depending on the status of it."
//
// So every coloured thing on this card — the left stripe, the bloom in the
// corner, the pill — is `status.color`: the colour the FIRM chose on the Task
// statuses page. Move a task from Waiting on client to Done and the card
// follows it. That is what makes a board of mostly-amber say "I am waiting on
// clients" from across the room, and it is the same palette the Work overview's
// donut is already drawn in.
//
// A firm can point two statuses at the same colour and make two cards look
// alike. Founder: "that's on the person. Right? That's not on us." Agreed, and
// the kind label at the top still separates them.
//
// ── WHAT IS ON THE FACE ───────────────────────────────────────────────────
//
// Kind, title, status, due date, assignees, comments — and the subtask bar ONLY
// when there are subtasks. A progress bar that is always 0% because a task has
// no steps is a bar that teaches you to stop reading bars.
//
// ── IT REUSES THE ROW'S BRAIN ─────────────────────────────────────────────
//
// Same RowMenuItem list, same right-click renderer, same comment bubble, same
// status menu, same `run()` optimistic patcher. This is a SKIN, not a second
// implementation — the founder's standing complaint about the engagement task
// view was that it "doesnt match with the actual tasks screen", and two
// implementations is how that comes back.

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { GripVertical } from "lucide-react";
import { formatDue, isOverdue } from "@/lib/tasks/due";
import { TaskKindIcon } from "@/components/engagements/task-kind-icon";

export type TaskCardStatus = { id: string; name: string; color: string };

export function TaskCard({
  title,
  kind,
  kindLabel,
  status,
  dueDate,
  taskStatus,
  assignees,
  subtasks,
  dragging,
  dragOver,
  canDrag,
  onOpen,
  statusMenu,
  children,
  dragHandleProps,
  dropProps,
  t,
}: {
  title: string;
  kind: string;
  kindLabel: string;
  status: TaskCardStatus;
  dueDate?: string | null;
  /** The BUCKET, for the overdue rule — never the label. */
  taskStatus: string;
  assignees: { id: string; name: string }[];
  subtasks?: { status: string }[];
  dragging?: boolean;
  dragOver?: boolean;
  canDrag?: boolean;
  onOpen: () => void;
  /** The row's own status control, handed in so the two surfaces cannot drift
   *  into different menus. */
  statusMenu: ReactNode;
  /** The comment bubble, same. */
  children?: ReactNode;
  /** Goes on the HANDLE — the only draggable part. */
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
  /** Goes on the WHOLE CARD. ⚠️ The drop target has to be the card, not the
   *  handle: a handle is ~14px and only appears on hover, so requiring the
   *  release to land on one made dragging impossible in practice. Founder,
   *  on the first version: "dragging doesnt work." */
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
  t: ReturnType<typeof useTranslations<"Engagements">>;
}) {
  const overdue = isOverdue(dueDate, taskStatus);
  const steps = subtasks?.length ?? 0;
  const stepsDone = subtasks?.filter((s) => s.status === "done").length ?? 0;

  return (
    <div
      // A DIV, not a button. The card carries a status menu, a comment bubble
      // and a drag handle, and a button cannot legally contain any of them.
      // Enter and Space are wired below so it stays reachable without a mouse.
      role="button"
      tabIndex={0}
      {...dropProps}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      // Every colour on the card comes from here, so one variable moves all of
      // them when the status changes.
      style={{ ["--task-hue" as string]: status.color }}
      className={cn(
        "group/card relative cursor-pointer rounded-lg border border-border bg-card px-4 py-3.5 text-left",
        "transition-[border-color,box-shadow,opacity] duration-150",
        // A quiet border and a plain shadow on hover. The coloured glow this
        // replaces is what made a list of tasks look like a synth panel.
        "hover:border-foreground/20 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "opacity-40",
        dragOver && "border-foreground/40 ring-1 ring-foreground/20",
      )}
    >
      {/* ── KARBON'S LINE ──────────────────────────────────────────────────
          Founder: "remove the gradient add the line like in the screenshot i
          sent from karbon". Their cards carry a thin horizontal rule under the
          title, and that rule is where the colour lives — no glow, no bloom, no
          neon edge. It reads as stationery rather than as a dashboard widget,
          which is the whole difference between "techy" and "professional".

          The radial gradient that used to sit here was the techy part. Gone
          rather than toned down: a faint version of a wrong idea is still the
          wrong idea. */}
      <div className="flex items-center gap-1.5">
        <TaskKindIcon kind={kind} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </span>
        <span className="flex-1" />
        {canDrag && (
          // The handle is the ONLY draggable part. Making the whole card
          // draggable means every attempt to click one starts a drag on a
          // trackpad, which is how a nice feature becomes an obstacle.
          <span
            {...dragHandleProps}
            aria-label={t("task_reorder", { title })}
            title={t("task_reorder", { title })}
            className="-mr-1 shrink-0 cursor-grab rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/card:opacity-100 active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </span>
        )}
      </div>

      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{title}</p>

      {/* THE LINE. Always present, because a card whose rule appears only
          sometimes reads as two different cards. It carries the status colour,
          which is the founder's rule: "the color of the task align with the
          status of the task... so the colors can change depending on the
          status of it."

          With steps, it is a real progress bar and says so underneath. Without
          them it is a full rule in the status colour — an accent, and NOT a
          claim that the task is 100% done. That distinction is why the caption
          only appears when there is something to count. */}
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-border">
        <span
          className="block h-full rounded-full bg-[var(--task-hue)] transition-[width,background-color] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{
            width: steps > 0 ? `${Math.round((stepsDone / steps) * 100)}%` : "100%",
          }}
        />
      </div>
      {steps > 0 && (
        <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
          {t("task_steps_done", { done: stepsDone, total: steps })}
        </p>
      )}

      <div
        className="mt-3 flex items-center gap-2"
        // The controls below act on the task, not on "open the task".
        onClick={(e) => e.stopPropagation()}
      >
        {statusMenu}
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {dueDate ? formatDue(dueDate) : "—"}
        </span>
        <span className="flex-1" />
        {/* The count comes from the BUBBLE, which is also the thing you click
            to open the thread. An extra read-only count beside it rendered the
            number twice — "1  1" — on any task that had a comment. */}
        {children}
        {assignees.length > 0 ? (
          <span className="flex shrink-0 -space-x-1.5">
            {assignees.slice(0, 3).map((a) => (
              <AvatarInitials key={a.id} name={a.name} size={20} />
            ))}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {t("assign_nobody")}
          </span>
        )}
      </div>
    </div>
  );
}
