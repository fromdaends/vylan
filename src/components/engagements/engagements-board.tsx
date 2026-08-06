"use client";

// The Work BOARD — Karbon's capacity dashboard shape on Vylan's rows.
//
// Columns are TEAM MEMBERS (plus Unassigned), because this board exists for
// workload balancing: who is carrying what, and what can move. Cards are the
// same WorklistRow the list renders — same client, same status vocabulary,
// same due-date rules — so the two views cannot disagree about a job.
//
// DRAG = REASSIGN, nothing else. Dropping a card on a column calls the SAME
// reassignEngagementAction the row menu uses (audit-logged, assignment email
// respected), optimistically with rollback. No stage columns, no stage
// dragging — stages move via the workflow engine or the engagement page (v1
// rule, stated in the spec).
//
// EXPAND shows the job's OPEN tasks with LIVE checkboxes wired to the same
// updateTaskAction the Tasks page uses — so the workflow engine's
// stage_tasks_done auto-advance fires identically from here. The task read
// layer does not expose per-stage tags yet; until it does, the expand shows
// the job's open tasks (and falls back to checklist progress when a job has
// no tasks at all) rather than guessing at stages.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { CheckSquare, ChevronDown, ChevronUp, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusCapsule } from "@/components/ui/status-capsule";
import { formatDate, type AppLocale } from "@/lib/format";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import {
  loadEngagementTasksPanelAction,
  updateTaskAction,
} from "@/app/actions/engagement-tasks";
import { reassignEngagementAction } from "@/app/actions/engagements";

type BoardTask = {
  id: string;
  title: string;
  done: boolean;
};

export function EngagementsBoard({
  rows,
  members,
  locale,
  canReassign,
  today,
}: {
  rows: WorklistRow[];
  members: { id: string; name: string }[];
  locale: AppLocale;
  /** Team mode on — drag targets light up; off — the board is read-only. */
  canReassign: boolean;
  /** Firm-tz today, for the overdue highlight — never new Date() here. */
  today: string;
}) {
  const t = useTranslations("Engagements");
  const tStatus = useTranslations("Status");
  const router = useRouter();
  // Optimistic reassignment overrides, id → new assignee (null = unassigned).
  const [moved, setMoved] = useState<Map<string, string | null>>(new Map());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Expanded card → its fetched tasks (undefined = loading).
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [tasksByCard, setTasksByCard] = useState<Map<string, BoardTask[]>>(
    new Map(),
  );

  const assigneeOf = (r: WorklistRow) =>
    moved.has(r.id) ? moved.get(r.id)! : r.assigneeUserId;

  const columns: { id: string | null; name: string }[] = [
    ...members.map((m) => ({ id: m.id as string | null, name: m.name })),
    { id: null, name: t("board_unassigned") },
  ];

  const drop = (columnId: string | null) => {
    if (!dragId || !canReassign) return;
    const row = rows.find((r) => r.id === dragId);
    setDragId(null);
    setOverCol(null);
    if (!row || assigneeOf(row) === columnId) return;
    const previous = assigneeOf(row);
    setMoved((m) => new Map(m).set(row.id, columnId));
    void (async () => {
      const res = await reassignEngagementAction(row.id, columnId);
      if (res.ok) {
        toast.success(t("board_reassigned"));
        router.refresh();
      } else {
        // Roll the card back where it was — a board that lies about who owns
        // a job is worse than a failed drag.
        setMoved((m) => new Map(m).set(row.id, previous));
        toast.error(t("board_reassign_failed"));
      }
    })();
  };

  const toggleExpand = (rowId: string) => {
    if (openCard === rowId) {
      setOpenCard(null);
      return;
    }
    setOpenCard(rowId);
    if (!tasksByCard.has(rowId)) {
      void (async () => {
        const res = await loadEngagementTasksPanelAction(rowId);
        setTasksByCard((m) =>
          new Map(m).set(
            rowId,
            res.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              done: task.status === "done",
            })),
          ),
        );
      })();
    }
  };

  const toggleTask = (rowId: string, task: BoardTask) => {
    // Optimistic tick; the SAME mutation the Tasks page uses, so the workflow
    // engine's auto-advance fires exactly as it would there.
    setTasksByCard((m) => {
      const list = m.get(rowId) ?? [];
      return new Map(m).set(
        rowId,
        list.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)),
      );
    });
    void (async () => {
      const res = await updateTaskAction({
        taskId: task.id,
        engagementId: rowId,
        status: task.done ? "todo" : "done",
      });
      if (!res.ok) {
        setTasksByCard((m) => {
          const list = m.get(rowId) ?? [];
          return new Map(m).set(
            rowId,
            list.map((x) => (x.id === task.id ? { ...x, done: task.done } : x)),
          );
        });
        toast.error(t("board_task_failed"));
      } else {
        router.refresh();
      }
    })();
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map((col) => {
          const cards = rows.filter((r) => assigneeOf(r) === col.id);
          return (
            <div
              key={col.id ?? "__unassigned__"}
              className={cn(
                "w-[280px] shrink-0 rounded-lg border border-border bg-muted/20 p-2",
                overCol === (col.id ?? "__u__") &&
                  dragId &&
                  "border-accent bg-accent/5",
              )}
              onDragOver={(e) => {
                if (!canReassign) return;
                e.preventDefault();
                setOverCol(col.id ?? "__u__");
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.id);
              }}
            >
              <p className="flex items-center justify-between px-1 pb-2 text-sm font-medium">
                <span className="truncate">{col.name}</span>
                <span className="text-muted-foreground">{cards.length}</span>
              </p>
              <div className="space-y-2">
                {cards.map((row) => {
                  const overdue =
                    row.dueDate != null &&
                    row.dueDate < today &&
                    row.status !== "complete" &&
                    row.status !== "cancelled";
                  const expanded = openCard === row.id;
                  const tasks = tasksByCard.get(row.id);
                  const open = (tasks ?? []).filter((x) => !x.done);
                  const done = (tasks ?? []).filter((x) => x.done);
                  return (
                    <div
                      key={row.id}
                      draggable={canReassign}
                      onDragStart={() => setDragId(row.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      className={cn(
                        "rounded-md border border-border bg-card p-2.5 text-sm shadow-sm",
                        canReassign && "cursor-grab active:cursor-grabbing",
                        dragId === row.id && "opacity-60",
                      )}
                    >
                      <p className="truncate text-xs text-muted-foreground">
                        {row.clientName}
                      </p>
                      <button
                        type="button"
                        className="block w-full truncate text-left font-medium hover:underline"
                        onClick={() => router.push(`/engagements/${row.id}`)}
                      >
                        {row.title}
                      </button>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <StatusCapsule
                          tone={
                            row.derivedStatus === "complete"
                              ? "success"
                              : row.derivedStatus === "ready_to_review"
                                ? "accent"
                                : "muted"
                          }
                        >
                          {tStatus(row.derivedStatus)}
                        </StatusCapsule>
                        {row.tasksTotal > 0 && (
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {t("board_progress", {
                              done: row.tasksDone,
                              total: row.tasksTotal,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span
                          className={cn(
                            "text-[11px]",
                            overdue
                              ? "font-medium text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {row.dueDate
                            ? formatDate(row.dueDate, locale, "compact")
                            : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleExpand(row.id)}
                          aria-expanded={expanded}
                          aria-label={t("board_expand")}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {expanded ? (
                            <ChevronUp className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="size-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                      {expanded && (
                        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                          {tasks == null ? (
                            <p className="text-xs text-muted-foreground">…</p>
                          ) : tasks.length === 0 ? (
                            // No tasks at all → the checklist-progress
                            // fallback: the bar the row already carries.
                            <p className="text-xs text-muted-foreground">
                              {t("board_no_tasks", {
                                percent: Math.round(row.approvedPct * 100),
                              })}
                            </p>
                          ) : (
                            <>
                              {open.map((task) => (
                                <TaskLine
                                  key={task.id}
                                  task={task}
                                  onToggle={() => toggleTask(row.id, task)}
                                />
                              ))}
                              {done.length > 0 && (
                                <p className="pt-0.5 text-[11px] text-muted-foreground">
                                  {t("board_done_count", { count: done.length })}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskLine({
  task,
  onToggle,
}: {
  task: BoardTask;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left text-xs transition-colors hover:bg-muted/40"
    >
      {task.done ? (
        <CheckSquare className="size-3.5 shrink-0 text-accent" aria-hidden />
      ) : (
        <Square className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className={cn("truncate", task.done && "line-through opacity-60")}>
        {task.title}
      </span>
    </button>
  );
}
