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
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import {
  AddTaskDialog,
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
  viewerId,
  today,
  timeZone,
}: {
  tasks: DashboardTask[];
  members: Person[];
  clients: ComboboxClient[];
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
  const [draft, setDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);

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
    opts?: { hideToday?: boolean; showEmpty?: boolean },
  ) => {
    const list = groups[key];
    if (list.length === 0) return null;
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
          {list.map((task, i) => (
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
                  className="mt-px"
                />
              </span>
              <DueIndicator
                dueDate={task.dueDate}
                status={task.status}
                today={today}
                hideToday={opts?.hideToday}
                showEmpty={opts?.showEmpty}
              />
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
            </div>
          ))}
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
                  className="mt-px"
                />
              </span>
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
            </div>
          ))}
        </div>
      ) : (
        <>
          {group("overdue", t("tasks_group_overdue"), "text-destructive")}
          {group(
            "today",
            t("tasks_group_today", { date: todayLabel }),
            "text-accent",
            { hideToday: true },
          )}
          {group("week", t("tasks_group_week"), "text-muted-foreground")}
          {group("later", t("tasks_group_later"), "text-muted-foreground", {
            showEmpty: true,
          })}
          {group("doneToday", t("tasks_group_done_today"), "text-success")}
        </>
      )}

      {/* Quick-add: type the title here, and the Add button opens THE add-task
          popover (the same one /work and every job use) seeded with it — the
          client picker and optional due date live there. One add-task UI. */}
      <div className="mt-5 flex items-center gap-2.5 border-t border-border/70 pt-4">
        <div className="relative min-w-0 flex-1">
          <Plus
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                setAddOpen(true);
              }
            }}
            placeholder={t("tasks_quickadd_placeholder")}
            aria-label={t("tasks_quickadd_placeholder")}
            className="h-[34px] bg-background pl-8 text-[13.5px]"
          />
        </div>
        <AddTaskDialog
          mode="firm"
          clients={clients}
          open={addOpen}
          onOpenChange={setAddOpen}
          initialTitle={draft.trim()}
          onCreated={() => setDraft("")}
          trigger={
            <button
              type="button"
              disabled={!draft.trim()}
              className="h-[34px] flex-none rounded-md bg-secondary px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("tasks_quickadd_add")}
            </button>
          }
        />
      </div>
    </div>
  );
}
