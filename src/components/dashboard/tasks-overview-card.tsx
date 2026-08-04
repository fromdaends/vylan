"use client";

// The Tasks card (design 2a) — the dashboard's main column: every open task in
// the firm, grouped by urgency, with the same three-state checkbox, assignee
// menu and due labels as every other task list.
//
// A DIFFERENT LAYOUT of the SAME row InternalWork draws, not a second task
// list: the pieces (checkbox, who-for line, due indicator, assignee menu) come
// from task-bits.tsx and the data comes from the same listFirmTasks() read.
// The grouping is this card's whole personality — a flat list already exists
// at /work, and this card exists to answer "what order do I do these in".
//
// Groups are computed by lib/tasks/dates — the same functions the stats strip
// counts with, so a strip saying "3 due this week" can never sit above a card
// showing four.

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  AddTaskDialog,
  type AddTaskEngagement,
} from "@/components/engagements/add-task-dialog";
import type { ComboboxClient } from "@/components/clients/client-combobox";
import {
  DueIndicator,
  NEXT_STATUS,
  TaskAssigneeMenu,
  TaskStatusCheckbox,
  TaskWhoFor,
  type Person,
  type TaskStatus,
} from "@/components/work/task-bits";
import {
  setTaskAssigneeAction,
  updateTaskAction,
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";
import { groupTasks, type TaskGroups } from "@/lib/tasks/dates";

export type DashboardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  clientName: string | null;
  engagementTitle: string | null;
  dueDate: string | null;
  completedAt: string | null;
};

type Tab = "all" | "mine" | "done";

type Patch = { id: string; status?: TaskStatus; assigneeIds?: string[] };

export function TasksOverviewCard({
  tasks,
  members,
  clients,
  engagements,
  viewerId,
  today,
  timeZone,
}: {
  tasks: DashboardTask[];
  members: Person[];
  clients: ComboboxClient[];
  /** For the quick-add's popover: a collection kind needs a job to hang off. */
  engagements: AddTaskEngagement[];
  viewerId: string;
  /** YYYY-MM-DD in the firm's timezone — the anchor every group hangs off. */
  today: string;
  timeZone: string;
}) {
  const t = useTranslations("Dashboard");
  const tWork = useTranslations("Engagements");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("all");

  // Server truth with any in-flight change already applied — the exact
  // optimistic shape InternalWork uses, so a tick lands instantly here too.
  const [rows, patch] = useOptimistic(
    tasks,
    (state: DashboardTask[], p: Patch) =>
      state.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
  );

  function run(p: Patch, call: () => Promise<TaskActionResult>) {
    startTransition(async () => {
      patch(p);
      const res = await call();
      if (res.ok) {
        router.refresh();
        return;
      }
      toast.error(
        res.needsMigration ? tWork("work_needs_migration") : tWork("work_failed"),
      );
    });
  }

  const openCount = rows.filter((r) => r.status !== "done").length;
  const mineCount = rows.filter(
    (r) => r.status !== "done" && r.assigneeIds.includes(viewerId),
  ).length;

  const shown = useMemo(
    () =>
      tab === "mine"
        ? rows.filter(
            (r) => r.status === "done" || r.assigneeIds.includes(viewerId),
          )
        : rows,
    [rows, tab, viewerId],
  );

  const groups: TaskGroups<DashboardTask> = useMemo(
    () => groupTasks(shown, today, timeZone),
    [shown, today, timeZone],
  );

  // "Today — Monday, Aug 3"
  const todayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${today}T12:00:00Z`));

  const doneRows = useMemo(
    () => rows.filter((r) => r.status === "done"),
    [rows],
  );

  const tabButton = (key: Tab, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={cn(
        "rounded-full px-3 py-[5px] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tab === key
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("ml-1 tabular-nums", tab === key && "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );

  const group = (
    key: keyof TaskGroups<DashboardTask>,
    label: string,
    headerClass: string,
    opts?: {
      hideToday?: boolean;
      showEmpty?: boolean;
      /** Rows shown before the "+ n more" link. Overdue and Today are never
       *  capped — hiding urgent work to save pixels is how it gets missed. */
      max?: number;
      moreHref?: string;
    },
  ) => {
    const list = groups[key];
    if (list.length === 0) return null;
    const max = opts?.max ?? Infinity;
    const visible = list.slice(0, max);
    const hidden = list.length - visible.length;
    return (
      <div key={key}>
        <p
          className={cn(
            "mt-[18px] text-[11px] font-semibold uppercase tracking-[0.08em] first:mt-5",
            headerClass,
          )}
        >
          {label}
        </p>
        <div className="mt-1">
          {visible.map((task, i) => (
            <div
              key={task.id}
              className={cn(
                "group -mx-2 flex items-center gap-3 rounded-md px-2 py-[11px] transition-colors hover:bg-secondary/60",
                i > 0 && "border-t border-border/50",
              )}
            >
              <TaskStatusCheckbox
                status={task.status}
                onCycle={() =>
                  run({ id: task.id, status: NEXT_STATUS[task.status] }, () =>
                    updateTaskAction({
                      taskId: task.id,
                      engagementId: task.engagementId,
                      status: NEXT_STATUS[task.status],
                    }),
                  )
                }
                ariaLabel={tWork("work_toggle", { title: task.title })}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm font-medium",
                    task.status === "done" &&
                      "text-muted-foreground line-through decoration-border",
                  )}
                >
                  {task.title}
                </span>
                <TaskWhoFor
                  clientId={task.clientId}
                  clientName={task.clientName}
                  engagementId={task.engagementId}
                  engagementTitle={task.engagementTitle}
                  taskTitle={task.title}
                  className="mt-px"
                />
              </span>
              {/* FIXED right columns — due then assignee — so the values line
                  up down the card instead of floating ragged after each
                  title. The client profile's status column set the precedent:
                  a mixed list stays scannable when its columns hold still. */}
              <span className="flex w-[120px] flex-none items-center justify-end text-right">
                <DueIndicator
                  dueDate={task.dueDate}
                  status={task.status}
                  today={today}
                  hideToday={opts?.hideToday}
                  showEmpty={opts?.showEmpty}
                />
              </span>
              <span className="flex w-[110px] flex-none items-center justify-end">
                <TaskAssigneeMenu
                  assigneeIds={task.assigneeIds}
                  members={members}
                  canEdit
                  avatarSize={22}
                  unassignedLabel={tWork("work_unassigned")}
                  onToggle={(userId, on) =>
                    run(
                      {
                        id: task.id,
                        assigneeIds: on
                          ? [...task.assigneeIds, userId]
                          : task.assigneeIds.filter((x) => x !== userId),
                      },
                      () =>
                        setTaskAssigneeAction({
                          taskId: task.id,
                          userId,
                          on,
                          engagementId: task.engagementId,
                        }),
                    )
                  }
                />
              </span>
            </div>
          ))}
          {hidden > 0 && opts?.moreHref && (
            <Link
              href={opts.moreHref}
              className="block border-t border-border/50 py-2 pl-8 text-xs text-muted-foreground transition-colors hover:text-accent"
            >
              {t("tasks_more", { count: hidden })}
            </Link>
          )}
        </div>
      </div>
    );
  };

  const empty =
    tab === "done"
      ? doneRows.length === 0
      : groups.overdue.length +
          groups.today.length +
          groups.week.length +
          groups.later.length +
          groups.doneToday.length ===
        0;

  return (
    <div className="rounded-xl border border-border bg-card px-7 py-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">
          {t("tasks_card_title")}
        </h2>
        <div className="flex items-center gap-1.5">
          {tabButton("all", t("tasks_tab_all"), openCount)}
          {tabButton("mine", t("tasks_tab_mine"), mineCount)}
          {tabButton("done", t("tasks_tab_done"))}
          <Link
            href="/work"
            className="ml-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("tasks_view_all")}
          </Link>
          {/* THE SAME BUTTON as the Tasks page and every job. Founder: "the
              create new task button on the overview page is outdated. Make it
              look and functioon like every other new task button." It was a
              type-a-title bar with its own grey Add — a third way to make a
              task, which is exactly what the merge in #1235 was for. */}
          <AddTaskDialog
            clients={clients}
            engagements={engagements}
            members={members}
          />
        </div>
      </div>

      {empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tab === "done" ? t("tasks_done_empty") : t("tasks_empty")}
        </p>
      ) : tab === "done" ? (
        // The Done tab is a plain list, newest finish first — an archive
        // shelf, so no urgency groups and no due chips.
        <div className="mt-1">
          {doneRows.map((task, i) => (
            <div
              key={task.id}
              className={cn(
                "group -mx-2 flex items-center gap-3 rounded-md px-2 py-[11px] transition-colors hover:bg-secondary/60",
                i > 0 && "border-t border-border/50",
              )}
            >
              <TaskStatusCheckbox
                status={task.status}
                onCycle={() =>
                  run({ id: task.id, status: NEXT_STATUS[task.status] }, () =>
                    updateTaskAction({
                      taskId: task.id,
                      engagementId: task.engagementId,
                      status: NEXT_STATUS[task.status],
                    }),
                  )
                }
                ariaLabel={tWork("work_toggle", { title: task.title })}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-muted-foreground line-through decoration-border">
                  {task.title}
                </span>
                <TaskWhoFor
                  clientId={task.clientId}
                  clientName={task.clientName}
                  engagementId={task.engagementId}
                  engagementTitle={task.engagementTitle}
                  taskTitle={task.title}
                  className="mt-px"
                />
              </span>
              <span className="flex w-[110px] flex-none items-center justify-end">
                <TaskAssigneeMenu
                  assigneeIds={task.assigneeIds}
                  members={members}
                  canEdit
                  avatarSize={22}
                  unassignedLabel={tWork("work_unassigned")}
                  onToggle={(userId, on) =>
                    run(
                      {
                        id: task.id,
                        assigneeIds: on
                          ? [...task.assigneeIds, userId]
                          : task.assigneeIds.filter((x) => x !== userId),
                      },
                      () =>
                        setTaskAssigneeAction({
                          taskId: task.id,
                          userId,
                          on,
                          engagementId: task.engagementId,
                        }),
                    )
                  }
                />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Overdue and Today are never capped — that IS the page. The
              calmer groups cap with a "+ n more" so twenty later-tasks or a
              productive afternoon can't bury the urgent ones (founder's call,
              2026-08-03: "way too many tasks displayed at a time"). */}
          {group("overdue", t("tasks_group_overdue"), "text-destructive")}
          {group(
            "today",
            t("tasks_group_today", { date: todayLabel }),
            "text-accent",
            { hideToday: true },
          )}
          {group("week", t("tasks_group_week"), "text-muted-foreground", {
            max: 5,
            moreHref: "/work?due=week",
          })}
          {group("later", t("tasks_group_later"), "text-muted-foreground", {
            showEmpty: true,
            max: 5,
            moreHref: "/work",
          })}
          {group("doneToday", t("tasks_group_done_today"), "text-success", {
            max: 3,
            moreHref: "/work?open=0",
          })}
        </>
      )}

    </div>
  );
}
