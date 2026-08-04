"use client";

// THE tasks table. One component, both screens, sortable and filterable.
//
// The founder, with a Canopy screenshot: "Overhaul the whole view of tasks...
// And i dont mean like only UI wise but the function of it istelf. Sorting and
// allat should be like Canopys."
//
// So this is a real table rather than a list of rows: named columns you can
// sort by, a filter per column that matters, and saved views across the top.
// The previous version was a list, which is fine for the six tasks on one job
// and useless for a hundred across a firm — you cannot ask a list "what is
// overdue and unassigned".
//
// ── WHY IT SORTS AND FILTERS IN THE BROWSER ────────────────────────────────
//
// Every task the firm has is already on the page — the list is in the hundreds,
// not the millions. Sending a query per click would put a network round trip
// between the founder and a sort order, which is the exact complaint that got
// assignment rewritten two changes ago. When this table stops fitting in one
// payload it should move to the server WITH pagination, not before.
//
// ── THE COLUMNS, AND THE TWO I DID NOT COPY ────────────────────────────────
//
// Canopy's screenshot carries Total Time and Tax year. Neither is here, and not
// for effort: Vylan has NO time tracking (it is phase 8 and deliberately last)
// and no tax-year field on anything. A column that renders "—" on every row for
// months is worse than no column — it teaches people the table is padding.
//
// Priority IS here, and I argued against it once. See 1390 for why that was the
// right call then and the wrong one now.
//
// ── A COLUMN HEADER IS A MENU, NOT AN ARROW ────────────────────────────────
//
// The founder, on the first version: "you're all able to sort by all of them,
// um, with the up and down little arrows when you click, and it'll do, like, I
// guess, most recent, but it's actually the most redundant sorting I've ever
// seen... clicking on it should actually bring you up a drop down to sort and,
// like, select specific clients."
//
// Right, and the diagnosis is sharper than the complaint: an arrow can only
// REORDER. Almost every question you bring to this table is a NARROWING —
// "what is Marie's", "what is high priority", "which document collections are
// still open" — and reordering a hundred rows so the answer floats to the top
// is not the same as showing the answer. So each header opens a menu with its
// sort directions AND its values, and the values are where the work happens.
//
// Task name has no menu, on their instruction: there is nothing to narrow a
// free-text name by, and A→Z on it answers no question anybody has.
//
// ── ONE TABLE, TWO SCREENS ─────────────────────────────────────────────────
//
// On a job the Client column is dropped, because every row has the same answer
// and a column with one value is decoration. Everything else is identical —
// that is the whole point, after "the task view for a specific engagement ...
// doesnt match with the actual tasks screen".

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneeAction,
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";
import { TaskDetailPanel } from "@/components/engagements/task-detail-panel";
import { taskKindLabelKey, taskKindHasScreen } from "@/lib/tasks/kinds";
import { TaskKindIcon } from "@/components/engagements/task-kind-icon";

type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "none" | "low" | "medium" | "high";

export type TaskRow = {
  id: string;
  title: string;
  kind: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  clientName?: string | null;
  engagementTitle?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  /** "2 of 3 done" for a kind that owns a collection. Job page only. */
  meta?: string;
};
type Person = { id: string; name: string };

const NEXT: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

// Rank, not alphabet. Sorting priority by its own name puts "high" between
// "none" and "medium", which is the opposite of what the column is for.
const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, doing: 1, done: 2 };

/** Which saved view is showing. Each is a question somebody actually opens this
 *  screen with, not a demonstration that views exist. */
export type TaskView = "active" | "mine" | "unassigned" | "done" | "all";
// Founder: "The unnasigned and completed tab bars for sorting should be
// removed like provided in the screenshot i sent." Both questions survive as
// FILTERS — Unassigned is a value in the assignee menu and Completed is one in
// the status menu — so nothing became unreachable, it stopped being a tab.
const VIEWS: TaskView[] = ["active", "mine", "all"];

type SortKey = "status" | "title" | "client" | "kind" | "assignee" | "priority" | "due";

export function TasksTable({
  tasks,
  members,
  canEdit,
  currentUserId,
  variant = "firm",
  addTask,
  onOpen,
}: {
  tasks: TaskRow[];
  members: Person[];
  canEdit: boolean;
  /** Drives the "Mine" view. */
  currentUserId: string;
  /** "job" drops the Client column — one value in it is decoration. */
  variant?: "firm" | "job";
  /** The "+ Add task" control, rendered in the toolbar. */
  addTask?: React.ReactNode;
  /** Opens a task's own screen. Job page only; see task-detail-panel.tsx. */
  onOpen?: (taskId: string) => void;
}) {
  const t = useTranslations("Engagements");
  const tStatus = useTranslations("Clients");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [rows, patch] = useOptimistic(tasks, (state: TaskRow[], p: Patch) =>
    p.remove
      ? state.filter((r) => r.id !== p.id)
      : state.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
  );

  const [view, setView] = useState<TaskView>("active");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "due",
    desc: false,
  });
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const firmWide = variant === "firm";
  const nameById = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
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
        res.needsMigration
          ? t("work_needs_migration")
          : res.error === "bad_title"
            ? t("work_bad_title")
            : t("work_failed"),
      );
    });
  }

  // One source for every kind's label, icon and hint — see lib/tasks/kinds.ts
  // for why the ternary chain that used to live here had to go.
  const kindLabel = (kind: string) =>
    t(taskKindLabelKey(kind) as "kind_task");

  const inView = (r: TaskRow, v: TaskView) =>
    v === "all"
      ? true
      : v === "done"
        ? r.status === "done"
        : v === "unassigned"
          ? r.status !== "done" && r.assigneeIds.length === 0
          : v === "mine"
            ? r.status !== "done" && r.assigneeIds.includes(currentUserId)
            : r.status !== "done";

  const counts = useMemo(
    () =>
      Object.fromEntries(
        VIEWS.map((v) => [v, rows.filter((r) => inView(r, v)).length]),
      ) as Record<TaskView, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, currentUserId],
  );

  const shown = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        inView(r, view) &&
        (statusFilter.length === 0 || statusFilter.includes(r.status)) &&
        (clientFilter.length === 0 || clientFilter.includes(r.clientId)) &&
        (kindFilter.length === 0 || kindFilter.includes(r.kind)) &&
        (priorityFilter.length === 0 || priorityFilter.includes(r.priority)) &&
        (assigneeFilter.length === 0 ||
          assigneeFilter.some((a) =>
            a === "none" ? r.assigneeIds.length === 0 : r.assigneeIds.includes(a),
          )),
    );
    const key = sort.key;
    const value = (r: TaskRow): string | number =>
      key === "status"
        ? STATUS_RANK[r.status]
        : key === "priority"
          ? PRIORITY_RANK[r.priority]
          : key === "client"
            ? (r.clientName ?? "").toLowerCase()
            : key === "kind"
              ? kindLabel(r.kind).toLowerCase()
              : key === "assignee"
                ? (nameById.get(r.assigneeIds[0] ?? "") ?? "").toLowerCase()
                : key === "due"
                  ? // No date sorts LAST whichever way the column is pointing.
                    // A blank is not "the earliest deadline in the firm", which
                    // is what an empty string would make it.
                    (r.dueDate ?? "9999-12-31")
                  : r.title.toLowerCase();
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return a.title.localeCompare(b.title);
      return (av < bv ? -1 : 1) * (sort.desc ? -1 : 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, view, sort, statusFilter, clientFilter, kindFilter, assigneeFilter, priorityFilter, nameById]);

  const kinds = useMemo(
    () => [...new Set(rows.map((r) => r.kind))].sort(),
    [rows],
  );


  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.clientId)) seen.set(r.clientId, r.clientName ?? "—");
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtersOn =
    statusFilter.length > 0 ||
    clientFilter.length > 0 ||
    kindFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    priorityFilter.length > 0;

  const clearAll = () => {
    setStatusFilter([]);
    setClientFilter([]);
    setKindFilter([]);
    setAssigneeFilter([]);
    setPriorityFilter([]);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* SAVED VIEWS. Each is a question somebody opens this screen with; the
          count is on the tab because "is there anything unassigned" is answered
          by the number alone, without clicking. */}
      <div
        role="tablist"
        className="flex flex-wrap items-center gap-1 border-b border-border"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-current={view === v ? "true" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              view === v
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`view_${v}` as "view_active")}{" "}
            <span className="tabular-nums opacity-60">{counts[v]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1.5">{addTask}</div>
      </div>

      {filtersOn && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("filters_clear")}
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("task_count_total", { count: shown.length })}
          </span>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filtersOn || view !== "active"
            ? t("tasks_none_match")
            : t(firmWide ? "work_empty_firm" : "work_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <ColumnMenu
                  label={t("col_status")}
                  t={t}
                  className="w-[136px]"
                  sortKey="status"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_lowest"), t("sort_highest")]}
                  selected={statusFilter}
                  onChange={(v) => setStatusFilter(v as TaskStatus[])}
                  options={(["todo", "doing", "done"] as TaskStatus[]).map((v) => ({
                    value: v,
                    label: tStatus(`task_status_${v}` as "task_status_todo"),
                  }))}
                />
                {/* Nothing to narrow a free-text name by, and A→Z on it answers
                    no question anybody brings here. The founder said so
                    outright, and they are right. */}
                <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("col_task")}
                </th>
                {firmWide && (
                  <ColumnMenu
                    label={t("col_client")}
                    t={t}
                    // THE DIVIDER. Canopy puts one right before Client and the
                    // founder asked for the same: it separates "what is this
                    // task" from "whose is it", which is the actual seam in
                    // the row.
                    className="w-[190px] border-l border-border"
                    sortKey="client"
                    sort={sort}
                    setSort={setSort}
                    sortLabels={[t("sort_asc"), t("sort_desc")]}
                    selected={clientFilter}
                    onChange={setClientFilter}
                    options={clientOptions}
                  />
                )}
                <ColumnMenu
                  label={t("col_kind")}
                  t={t}
                  className={cn("w-[170px]", !firmWide && "border-l border-border")}
                  sortKey="kind"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_asc"), t("sort_desc")]}
                  selected={kindFilter}
                  onChange={setKindFilter}
                  options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))}
                />
                <ColumnMenu
                  label={t("col_assignee")}
                  t={t}
                  className="w-[150px]"
                  sortKey="assignee"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_asc"), t("sort_desc")]}
                  selected={assigneeFilter}
                  onChange={setAssigneeFilter}
                  options={[
                    { value: "none", label: t("work_unassigned") },
                    ...members.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
                <ColumnMenu
                  label={t("col_priority")}
                  t={t}
                  className="w-[120px]"
                  sortKey="priority"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_lowest"), t("sort_highest")]}
                  selected={priorityFilter}
                  onChange={(v) => setPriorityFilter(v as TaskPriority[])}
                  options={(["high", "medium", "low", "none"] as TaskPriority[]).map(
                    (v) => ({ value: v, label: t(`priority_${v}` as "priority_none") }),
                  )}
                />
                <ColumnMenu
                  label={t("col_due")}
                  t={t}
                  className="w-[120px]"
                  sortKey="due"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_earliest"), t("sort_latest")]}
                />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {shown.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  firmWide={firmWide}
                  canEdit={canEdit}
                  members={members}
                  nameById={nameById}
                  kindLabel={kindLabel}
                  t={t}
                  tStatus={tStatus}
                  onOpenDetail={() => setDetailId(task.id)}
                  onOpenScreen={onOpen}
                  run={run}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskDetailPanel
        task={rows.find((r) => r.id === detailId) ?? null}
        members={members}
        canEdit={canEdit}
        kindLabel={(k) => (k === "task" ? null : kindLabel(k))}
        onClose={() => setDetailId(null)}
        onOpenScreen={onOpen}
        onPatch={(next, call) => {
          const task = rows.find((r) => r.id === detailId);
          if (!task) return;
          run({ id: task.id, ...next }, () =>
            call.assigneeId
              ? setTaskAssigneeAction({
                  taskId: task.id,
                  userId: call.assigneeId,
                  on: call.on === true,
                  engagementId: task.engagementId,
                })
              : updateTaskAction({
                  taskId: task.id,
                  engagementId: task.engagementId,
                  title: next.title,
                  status: next.status,
                  dueDate: next.dueDate,
                  notes: next.notes,
                  priority: next.priority,
                }),
          );
        }}
      />
    </div>
  );
}

type Patch =
  | { id: string; remove: true }
  | ({ id: string; remove?: false } & Partial<
      Pick<
        TaskRow,
        "status" | "assigneeIds" | "title" | "notes" | "dueDate" | "priority"
      >
    >);

type SortState = { key: SortKey; desc: boolean };

/**
 * A column header that is a MENU: its two sort directions, then its values.
 *
 * The values are the point. "Sort by client" floats one client's rows to the
 * top of a hundred; "show me only this client" answers the question. An arrow
 * could never do the second, which is what made the first version feel — the
 * founder's word — redundant.
 *
 * Omitting `options` gives a sort-only menu, which is right for a date: there
 * is nothing to tick in a column of a hundred distinct days.
 */
function ColumnMenu({
  label,
  t,
  className,
  sortKey,
  sort,
  setSort,
  sortLabels,
  options,
  selected = [],
  onChange,
}: {
  label: string;
  t: ReturnType<typeof useTranslations<"Engagements">>;
  className?: string;
  sortKey: SortKey;
  sort: SortState;
  setSort: (next: SortState) => void;
  /** [ascending, descending] — worded for the column. "Earliest first" beats
   *  "A → Z" on a date, and "Lowest first" beats it on a priority. */
  sortLabels: [string, string];
  options?: { value: string; label: string }[];
  selected?: string[];
  onChange?: (next: string[]) => void;
}) {
  const active = sort.key === sortKey;
  const filtering = selected.length > 0;

  return (
    <th className={cn("px-2 py-2 font-medium", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("column_menu", { label })}
            className={cn(
              "flex w-full items-center gap-1 text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active || filtering
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {filtering && (
              <span className="rounded-full bg-foreground px-1 text-[10px] tabular-nums text-background">
                {selected.length}
              </span>
            )}
            {active ? (
              sort.desc ? (
                <ArrowDown className="size-3 shrink-0" aria-hidden />
              ) : (
                <ArrowUp className="size-3 shrink-0" aria-hidden />
              )
            ) : (
              <ChevronsUpDown className="size-3 shrink-0 opacity-45" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            className="gap-2 text-xs"
            onSelect={() => setSort({ key: sortKey, desc: false })}
          >
            <ArrowUp className="size-3.5" aria-hidden />
            {sortLabels[0]}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-xs"
            onSelect={() => setSort({ key: sortKey, desc: true })}
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {sortLabels[1]}
          </DropdownMenuItem>

          {options && options.length > 0 && onChange && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
                {label}
              </DropdownMenuLabel>
              <div className="max-h-64 overflow-y-auto">
                {options.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o.value}
                    checked={selected.includes(o.value)}
                    // Stays open: narrowing to three clients should not cost
                    // three trips to the same header.
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) =>
                      onChange(
                        on
                          ? [...selected, o.value]
                          : selected.filter((x) => x !== o.value),
                      )
                    }
                  >
                    <span className="truncate">{o.label}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
              {filtering && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => onChange([])}
                  >
                    {t("filter_all")}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </th>
  );
}

function Row({
  task,
  firmWide,
  canEdit,
  members,
  nameById,
  kindLabel,
  t,
  tStatus,
  onOpenDetail,
  onOpenScreen,
  run,
}: {
  task: TaskRow;
  firmWide: boolean;
  canEdit: boolean;
  members: Person[];
  nameById: Map<string, string>;
  kindLabel: (kind: string) => string;
  t: ReturnType<typeof useTranslations<"Engagements">>;
  tStatus: ReturnType<typeof useTranslations<"Clients">>;
  onOpenDetail: () => void;
  onOpenScreen?: (taskId: string) => void;
  run: (p: Patch, call: () => Promise<TaskActionResult>) => void;
}) {
  const assignees = task.assigneeIds
    .map((id) => ({ id, name: nameById.get(id) }))
    .filter((a): a is Person => Boolean(a.name));
  // Only a kind with a real screen is clickable through.
  const openable = Boolean(onOpenScreen && taskKindHasScreen(task.kind));
  const overdue =
    task.dueDate && task.status !== "done" && task.dueDate < today();

  return (
    // THE WHOLE ROW OPENS THE PANEL. Founder: "clicking on the task name
    // shouldn't be the only way to bring up the sidebar. I think clicking on
    // the task itself should bring up the sidebar. like, the entire thing."
    //
    // Every control inside it — the status pill, the assignee menu, the
    // priority cell, the type link, delete — stops the click before it gets
    // here, so a row is only "the empty parts" in practice. Without that, one
    // careless click both ticks a task off and opens a panel about it.
    <tr
      onClick={onOpenDetail}
      className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/40"
    >
      <td className="px-2 py-2">
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation();
            run({ id: task.id, status: NEXT[task.status] }, () =>
              updateTaskAction({
                taskId: task.id,
                engagementId: task.engagementId,
                status: NEXT[task.status],
              }),
            );
          }}
          aria-label={t("work_toggle", { title: task.title })}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50",
            task.status === "done"
              ? "border-transparent bg-secondary text-muted-foreground"
              : task.status === "doing"
                ? "border-transparent bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              task.status === "done"
                ? "bg-muted-foreground"
                : task.status === "doing"
                  ? "bg-accent"
                  : "bg-border",
            )}
            aria-hidden
          />
          {tStatus(`task_status_${task.status}` as "task_status_todo")}
        </button>
      </td>

      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
            aria-label={t("task_open_detail", { title: task.title })}
            className={cn(
              "min-w-0 truncate text-left transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              task.status === "done" && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
          {task.meta && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {task.meta}
            </span>
          )}
          {openable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenScreen?.(task.id);
              }}
              aria-label={t("task_open", { title: task.title })}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </td>

      {firmWide && (
        <td className="border-l border-border px-2 py-2">
          <Link
            href={`/clients/${task.clientId}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            {task.clientName ?? "—"}
          </Link>
        </td>
      )}

      {/* THE TYPE IS A DOORWAY. Founder: "imagine there's a task for document
          collection on a specific engagement, but you're looking at it from the
          task view, and you wanna actually click on it and see the specific
          document collection on the engagement... like a link that brings you
          to the actual doc collection within the engagement, like, full page
          view."
          ?task= opens that exact task on arrival, so it lands ON the collection
          rather than on the job's task list with one more click to go. A plain
          task has no screen, so it stays plain text — a link to nowhere is
          worse than no link. */}
      <td
        className={cn(
          "px-2 py-2 text-muted-foreground",
          // ONE divider, and it sits where the row changes subject. On the
          // firm table that seam is before Client; on a job there is no Client
          // column, so it moves here.
          !firmWide && "border-l border-border",
        )}
      >
        {taskKindHasScreen(task.kind) && task.engagementId ? (
          <Link
            href={`/engagements/${task.engagementId}?task=${task.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-accent transition-colors hover:underline"
          >
            <TaskKindIcon kind={task.kind} className="size-3.5" />
            <span className="truncate">{kindLabel(task.kind)}</span>
          </Link>
        ) : (
          <span className="flex items-center gap-1.5">
            <TaskKindIcon kind={task.kind} className="size-3.5" />
            <span className="truncate">{kindLabel(task.kind)}</span>
          </span>
        )}
      </td>

      <td className="px-2 py-2">
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {assignees.length > 0 ? (
                  <>
                    {assignees.slice(0, 3).map((a) => (
                      <AvatarInitials key={a.id} name={a.name} size={18} />
                    ))}
                    {assignees.length > 3 && (
                      <span className="tabular-nums">
                        +{assignees.length - 3}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <UserPlus className="size-3.5" aria-hidden />
                    {t("work_unassigned")}
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {members.map((m) => {
                const on = task.assigneeIds.includes(m.id);
                return (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      run(
                        {
                          id: task.id,
                          assigneeIds: on
                            ? task.assigneeIds.filter((x) => x !== m.id)
                            : [...task.assigneeIds, m.id],
                        },
                        () =>
                          setTaskAssigneeAction({
                            taskId: task.id,
                            userId: m.id,
                            on: !on,
                            engagementId: task.engagementId,
                          }),
                      );
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
        ) : (
          <span className="flex items-center gap-1">
            {assignees.slice(0, 3).map((a) => (
              <AvatarInitials key={a.id} name={a.name} size={18} />
            ))}
          </span>
        )}
      </td>

      <td className="px-2 py-2">
        <PriorityCell task={task} canEdit={canEdit} run={run} t={t} />
      </td>

      <td
        className={cn(
          "px-2 py-2 tabular-nums",
          overdue ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {task.dueDate ? formatDue(task.dueDate) : "—"}
      </td>

      <td className="px-1 py-2">
        {canEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              run({ id: task.id, remove: true }, () =>
                deleteTaskAction({
                  taskId: task.id,
                  engagementId: task.engagementId,
                }),
              );
            }}
            aria-label={t("work_delete", { title: task.title })}
            className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </td>
    </tr>
  );
}

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  high: "text-destructive",
  medium: "text-[color:var(--stage-payment)]",
  low: "text-muted-foreground",
  none: "text-muted-foreground/60",
};

function PriorityCell({
  task,
  canEdit,
  run,
  t,
}: {
  task: TaskRow;
  canEdit: boolean;
  run: (p: Patch, call: () => Promise<TaskActionResult>) => void;
  t: ReturnType<typeof useTranslations<"Engagements">>;
}) {
  const label = t(`priority_${task.priority}` as "priority_none");
  if (!canEdit) {
    return <span className={PRIORITY_STYLE[task.priority]}>{label}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            PRIORITY_STYLE[task.priority],
          )}
        >
          {task.priority !== "none" && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-current"
              aria-hidden
            />
          )}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {(["high", "medium", "low", "none"] as TaskPriority[]).map((p) => (
          <DropdownMenuItem
            key={p}
            className={cn("gap-2", PRIORITY_STYLE[p])}
            onSelect={() =>
              run({ id: task.id, priority: p }, () =>
                updateTaskAction({
                  taskId: task.id,
                  engagementId: task.engagementId,
                  priority: p,
                }),
              )
            }
          >
            {task.priority === p && <Check className="size-3" aria-hidden />}
            {t(`priority_${p}` as "priority_none")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Today in the user's own timezone, as YYYY-MM-DD — the same shape due_date is
 *  stored in, so "overdue" is a string comparison and never a timezone bug. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Rendered from the parts, never `new Date(str)`: a bare YYYY-MM-DD is parsed
 *  as UTC midnight, which prints as the day BEFORE for anyone west of London. */
function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
