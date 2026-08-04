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
  Check,
  ChevronRight,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneeAction,
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";
import { TaskDetailPanel } from "@/components/engagements/task-detail-panel";
import { ColumnMenu, type SortState } from "@/components/ui/column-menu";
import { ViewTabs } from "@/components/ui/view-tabs";
import { taskKindLabelKey, taskKindHasScreen } from "@/lib/tasks/kinds";
import { TaskKindIcon } from "@/components/engagements/task-kind-icon";

type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "none" | "low" | "medium" | "high";

/** A status the firm named, as the table needs it. */
export type FirmStatus = {
  id: string;
  name: string;
  color: string;
  bucket: TaskStatus;
};

export type TaskRow = {
  id: string;
  title: string;
  kind: string;
  /** The BUCKET — todo / doing / done. Every rule in this file reads this and
   *  never the label, which is the whole reason a firm can rename freely. */
  status: TaskStatus;
  /** Which of the firm's statuses, when it has one. */
  statusId?: string | null;
  priority: TaskPriority;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  clientName?: string | null;
  engagementTitle?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  /** The steps inside this task. The ROW shows only their count; the panel
   *  shows the steps — see subtask-list.tsx for why they are not nested rows. */
  subtasks?: {
    id: string;
    title: string;
    status: TaskStatus;
    statusId?: string | null;
    assigneeIds: string[];
    dueDate?: string | null;
  }[];
  /** "2 of 3 done" for a kind that owns a collection. Job page only. */
  meta?: string;
};
type Person = { id: string; name: string };

// Rank, not alphabet. Sorting priority by its own name puts "high" between
// "none" and "medium", which is the opposite of what the column is for.
const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, doing: 1, done: 2 };

// How long a finished row keeps its place, and how long the undo is offered.
// ONE constant on purpose: an undo that outlives the row it refers to points at
// nothing, and a row that outlives the undo is just a stale list.
const DONE_LINGER_MS = 5000;

// Used only when a firm has no statuses of its own — the same three colours the
// seed in 1420 gives every firm, so the fallback looks like the real thing.
const BUCKET_FALLBACK_COLOR: Record<TaskStatus, string> = {
  todo: "#64748b",
  doing: "#2563eb",
  done: "#16a34a",
};

/** Which saved view is showing. Each is a question somebody actually opens this
 *  screen with, not a demonstration that views exist. */
export type TaskView = "active" | "mine" | "unassigned" | "done" | "all";
// Founder: "The unnasigned and completed tab bars for sorting should be
// removed like provided in the screenshot i sent." Both questions survive as
// FILTERS — Unassigned is a value in the assignee menu and Completed is one in
// the status menu — so nothing became unreachable, it stopped being a tab.
const VIEWS: TaskView[] = ["active", "mine", "all"];

export function TasksTable({
  tasks,
  members,
  canEdit,
  currentUserId,
  statuses,
  variant = "firm",
  initialView = "active",
  onOpen,
  maxRows,
  moreHref,
}: {
  tasks: TaskRow[];
  members: Person[];
  canEdit: boolean;
  /** The firm's own statuses, in board order. Empty before 1420 is applied,
   *  which is why every label falls back to the built-in three. */
  statuses: FirmStatus[];
  /** Drives the "Mine" view. */
  currentUserId: string;
  /** "job" drops the Client column — one value in it is decoration. */
  variant?: "firm" | "job";
  /**
   * Which saved view opens first.
   *
   * "active" is right when this table IS the screen — the working list. The
   * engagements list's task panel passes "all" instead, because you reach it by
   * clicking a job's TOTAL, and hiding the finished half of that total is the
   * one thing the panel must not do.
   */
  initialView?: TaskView;
  /** Opens a task's own screen. Job page only; see task-detail-panel.tsx. */
  onOpen?: (taskId: string) => void;
  /**
   * Show at most this many rows, with a "+N more" link to the rest.
   *
   * For the Overview, where this table is a PANEL on a page of other panels
   * rather than the page itself — uncapped it ran the dashboard down past
   * everything else on it. The cap is on what is DRAWN, never on what is
   * counted: the tabs above still say 22, because a truncated list that also
   * under-reports is a list you cannot trust.
   */
  maxRows?: number;
  /** Where "+N more" goes. Required for the cap to be honest about the rest. */
  moreHref?: string;
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

  // "active" everywhere the table is the page. The engagements list's panel
  // passes "all", because you get there by clicking a total.
  const [view, setView] = useState<TaskView>(
    // On a job there is no strip to change this with, so it must be the view
    // that shows the job's whole task list.
    variant === "job" ? "all" : initialView,
  );
  // NEWEST FIRST until you say otherwise. Founder: "tasks should auto sort for
  // newest to appear ontop always unless changed by filters and stuff." A task
  // you just made must be the one you can see — landing it in the middle of a
  // hundred rows sorted by due date is indistinguishable from it not saving.
  const [sort, setSort] = useState<SortState>({
    key: "created",
    desc: true,
  });
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Tasks ticked off in the last few seconds. They keep their place in the list
  // while the check is visible, so finishing something is a moment you can SEE
  // rather than a row vanishing out from under the cursor.
  const [justDone, setJustDone] = useState<string[]>([]);

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
  const kindLabel = (kind: string) => t(taskKindLabelKey(kind) as "kind_task");

  /**
   * Tick a task off — or put it back.
   *
   * The founder: "it's too fast, and there's no actual check mark. It just
   * disappears instantly... there should be a little pop up from the bottom
   * that says undo."
   *
   * So three things happen instead of one. The box shows a CHECK. The row HOLDS
   * its place for a few seconds even though it no longer belongs in this view,
   * so the check is something you see rather than infer. And a toast offers
   * UNDO for as long as the row is still there — the two are deliberately the
   * same length, so the offer never outlives the thing it refers to.
   */
  function setDone(task: TaskRow, done: boolean) {
    const next = done ? doneStatus : todoStatus;
    const previous = statusOf(task);
    if (!next) return;

    const write = (target: FirmStatus) =>
      run({ id: task.id, status: target.bucket, statusId: target.id }, () =>
        updateTaskAction({
          taskId: task.id,
          engagementId: task.engagementId,
          statusId: target.id.startsWith("bucket:") ? null : target.id,
          status: target.id.startsWith("bucket:") ? target.bucket : undefined,
        }),
      );

    write(next);
    if (!done) {
      // Un-ticking needs no ceremony: the row is coming back into view, which
      // is its own confirmation.
      setJustDone((ids) => ids.filter((id) => id !== task.id));
      return;
    }

    setJustDone((ids) => [...ids, task.id]);
    window.setTimeout(
      () => setJustDone((ids) => ids.filter((id) => id !== task.id)),
      DONE_LINGER_MS,
    );
    toast.success(t("task_done_toast", { title: task.title }), {
      duration: DONE_LINGER_MS,
      action: {
        label: t("undo"),
        onClick: () => {
          setJustDone((ids) => ids.filter((id) => id !== task.id));
          // Back to where it WAS, not to a generic "to do" — a task that was
          // "Needs review" must not come back as untouched.
          write(previous);
        },
      },
    });
  }

  // The label and colour a row wears. Falls back to the built-in three when the
  // firm has none — before 1420 is applied, and for a task whose status was
  // deleted out from under it. A row must never render blank.
  const statusOf = (task: TaskRow): FirmStatus =>
    statuses.find((x) => x.id === task.statusId) ??
    statuses.find((x) => x.bucket === task.status) ?? {
      id: `bucket:${task.status}`,
      name: tStatus(`task_status_${task.status}` as "task_status_todo"),
      color: BUCKET_FALLBACK_COLOR[task.status],
      bucket: task.status,
    };

  // What the Status column offers: the firm's own, or the built-in three.
  const statusOptions: FirmStatus[] =
    statuses.length > 0
      ? statuses
      : (["todo", "doing", "done"] as TaskStatus[]).map((b) => ({
          id: `bucket:${b}`,
          name: tStatus(`task_status_${b}` as "task_status_todo"),
          color: BUCKET_FALLBACK_COLOR[b],
          bucket: b,
        }));

  function inView(r: TaskRow, v: TaskView): boolean {
    // A task you just finished stays put until the check has been seen.
    // Without this the row disappears on the same frame as the click, which
    // reads as "something happened, no idea what" — and leaves nothing to undo
    // from.
    if (justDone.includes(r.id)) return true;
    if (v === "all") return true;
    if (v === "done") return r.status === "done";
    if (r.status === "done") return false;
    if (v === "unassigned") return r.assigneeIds.length === 0;
    if (v === "mine") return r.assigneeIds.includes(currentUserId);
    return true;
  }

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
        // Filtering is by the firm's STATUS, not the bucket: "Needs review"
        // and "With client" are both doing, and telling them apart is the
        // entire reason a firm names its own.
        (statusFilter.length === 0 ||
          statusFilter.includes(r.statusId ?? `bucket:${r.status}`)) &&
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
      key === "created"
        ? // Missing timestamps sort OLDEST, so a row from before this column
          // existed never jumps to the top of "newest".
          (r.createdAt ?? "")
        : key === "status"
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
                    ? // No date sorts LAST whichever way the column is
                      // pointing. A blank is not "the earliest deadline in the
                      // firm", which is what an empty string would make it.
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

  // What is drawn, versus what exists. `shown` stays the honest total so the
  // count and the tabs never disagree with each other.
  const visible = maxRows ? shown.slice(0, maxRows) : shown;
  const hidden = shown.length - visible.length;

  const kinds = useMemo(
    () => [...new Set(rows.map((r) => r.kind))].sort(),
    [rows],
  );


  // Where the tick-box sends a task, decided by the firm's own order.
  const doneStatus = statusOptions.find((x) => x.bucket === "done");
  const todoStatus = statusOptions.find((x) => x.bucket === "todo");

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
          by the number alone, without clicking.

          The strip itself moved to components/ui/view-tabs.tsx when the
          engagements page needed the same row. It looked identical to this the
          day it was written and had drifted into a strip of pills by the time
          the founder saw the two side by side — so now there is one of it. */}
      {/* ⚠️ NOT ON A SINGLE JOB. Saved views answer "which of my hundred
          tasks now?" — a question one engagement does not raise, and Canopy's
          engagement page has no such strip either.

          It was also actively wrong there. The panel sits under its OWN tab row
          (Manage tasks / Services / Client view), so a second strip 90px below
          the first read as a rendering mistake — and "Active work" hid a job
          whose two tasks were both finished, printing "Nothing planned on your
          side yet" underneath a count of two. */}
      {variant === "firm" && (
        <ViewTabs
          activeKey={view}
          onSelect={(key) => setView(key as TaskView)}
          tabs={VIEWS.map((v) => ({
            key: v,
            label: t(`view_${v}` as "view_active"),
            count: counts[v],
          }))}
        />
      )}

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

      {/* THE HEADER ROW ALWAYS RENDERS. Founder: "when there is no tasks the
          top sorting bars are gone... They should be there no matter what."
          Right — the controls that got you to an empty result are the ones you
          need to undo it, and a screen that removes them strands you. The
          message goes in a row INSIDE the table instead. */}
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
                  onChange={setStatusFilter}
                  options={statusOptions.map((v) => ({
                    value: v.id,
                    label: v.name,
                  }))}
                  // Subtle, at the foot of the menu: the moment you notice a
                  // status is missing is the moment you are looking at this
                  // list, and sending somebody to Settings to find that out is
                  // the long way round.
                  footerHref="/settings/statuses"
                  footerLabel={t("statuses_new")}
                />
                {/* Nothing to narrow a free-text name by, and A→Z on it answers
                    no question anybody brings here. The founder said so
                    outright, and they are right. */}
                {/* Matches ColumnMenu's type exactly, minus the menu — the
                    two sitting side by side in different cases was the tell
                    that one of them had been left behind. */}
                <th className="px-2 py-2.5 text-sm font-medium text-foreground/80">
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
                    className="w-[190px] border-l border-border/60"
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
                  className={cn("w-[170px] border-l border-border/60")}
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
                  className="w-[150px] border-l border-border/60"
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
                  className="w-[120px] border-l border-border/60"
                  sortKey="priority"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_lowest"), t("sort_highest")]}
                  selected={priorityFilter}
                  onChange={(v: string[]) => setPriorityFilter(v as TaskPriority[])}
                  options={(["high", "medium", "low", "none"] as TaskPriority[]).map(
                    (v) => ({ value: v, label: t(`priority_${v}` as "priority_none") }),
                  )}
                />
                <ColumnMenu
                  label={t("col_due")}
                  t={t}
                  className="w-[120px] border-l border-border/60"
                  sortKey="due"
                  sort={sort}
                  setSort={setSort}
                  sortLabels={[t("sort_earliest"), t("sort_latest")]}
                />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  status={statusOf(task)}
                  statusOptions={statusOptions}
                  firmWide={firmWide}
                  canEdit={canEdit}
                  members={members}
                  nameById={nameById}
                  kindLabel={kindLabel}
                  t={t}
                  onOpenDetail={() => setDetailId(task.id)}
                  onSetDone={(done) => setDone(task, done)}
                  onOpenScreen={onOpen}
                  run={run}
                />
              ))}
            {hidden > 0 && moreHref && (
                <tr>
                  <td colSpan={firmWide ? 8 : 7} className="px-2">
                    <Link
                      href={moreHref}
                      className="block py-2.5 text-xs text-muted-foreground transition-colors hover:text-accent"
                    >
                      {t("tasks_more", { count: hidden })}
                    </Link>
                  </td>
                </tr>
              )}
            {shown.length === 0 && (
                <tr>
                  <td
                    colSpan={firmWide ? 8 : 7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {filtersOn || view !== "active"
                      ? t("tasks_none_match")
                      : t(firmWide ? "work_empty_firm" : "work_empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      <TaskDetailPanel
        task={rows.find((r) => r.id === detailId) ?? null}
        members={members}
        canEdit={canEdit}
        statuses={statusOptions}
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
                  status: next.statusId ? undefined : next.status,
                  statusId: next.statusId?.startsWith("bucket:")
                    ? null
                    : next.statusId,
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
        | "status"
        | "statusId"
        | "assigneeIds"
        | "title"
        | "notes"
        | "dueDate"
        | "priority"
      >
    >);

function Row({
  task,
  status,
  statusOptions,
  firmWide,
  canEdit,
  members,
  nameById,
  kindLabel,
  t,
  onOpenDetail,
  onSetDone,
  onOpenScreen,
  run,
}: {
  task: TaskRow;
  /** Already resolved to the firm's label and colour. */
  status: FirmStatus;
  statusOptions: FirmStatus[];
  firmWide: boolean;
  canEdit: boolean;
  members: Person[];
  nameById: Map<string, string>;
  kindLabel: (kind: string) => string;
  t: ReturnType<typeof useTranslations<"Engagements">>;
  onOpenDetail: () => void;
  /** Tick it off, or put it back. The table owns the pause and the undo. */
  onSetDone: (done: boolean) => void;
  onOpenScreen?: (taskId: string) => void;
  run: (p: Patch, call: () => Promise<TaskActionResult>) => void;
}) {
  const assignees = task.assigneeIds
    .map((id) => ({ id, name: nameById.get(id) }))
    .filter((a): a is Person => Boolean(a.name));
  // Only a kind with a real screen is clickable through.
  const openable = Boolean(onOpenScreen && taskKindHasScreen(task.kind));
  const isDone = status.bucket === "done";
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
        <div className="flex items-center gap-2">
        {/* ONE CLICK TO TICK IT OFF. The founder, on the first version of this
            column: "how are you supposed to mark a task done. thats a major
            design flaw" — and they were right. Replacing the checkbox with a
            status menu made the single most common action on a task list cost
            two clicks and a read.
            So both live here: the BOX finishes it (and un-finishes it), the
            PILL beside it is for saying which of the firm's states it is in.
            A menu was still the right call for the pill — nine statuses cannot
            be clicked through — but it was never a replacement for this. */}
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation();
            onSetDone(!isDone);
          }}
          aria-label={t("task_mark_done", { title: task.title })}
          aria-pressed={isDone}
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-40",
            isDone
              ? "border-foreground bg-foreground text-background"
              : "border-border hover:border-foreground/60",
          )}
        >
          {isDone && <Check className="size-3" aria-hidden />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={t("work_toggle", { title: task.title })}
              className="flex items-center gap-1.5 rounded-full border border-transparent bg-muted px-2 py-0.5 text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: status.color }}
                aria-hidden
              />
              <span className="truncate">{status.name}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-52"
            onClick={(e) => e.stopPropagation()}
          >
            {statusOptions.map((option) => (
              <DropdownMenuItem
                key={option.id}
                className="gap-2"
                onSelect={() =>
                  run(
                    {
                      id: task.id,
                      status: option.bucket,
                      statusId: option.id.startsWith("bucket:")
                        ? null
                        : option.id,
                    },
                    () =>
                      updateTaskAction({
                        taskId: task.id,
                        engagementId: task.engagementId,
                        // The BUCKET is written by a database trigger from the
                        // status, so sending it too would be a second writer
                        // for one fact. Only the choice goes over the wire.
                        statusId: option.id.startsWith("bucket:")
                          ? null
                          : option.id,
                        status: option.id.startsWith("bucket:")
                          ? option.bucket
                          : undefined,
                      }),
                  )
                }
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                  aria-hidden
                />
                {option.name}
                {option.id === status.id && (
                  <Check className="ml-auto size-3.5" aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
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
          {/* The count IS the link between the row and the panel: "2 of 5"
              here, the five steps in there. */}
          {task.subtasks && task.subtasks.length > 0 && (
            <span className="shrink-0 rounded border border-border/70 px-1 py-px text-[10px] tabular-nums text-muted-foreground">
              {task.subtasks.filter((x) => x.status === "done").length}/
              {task.subtasks.length}
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
        <td className="border-l border-border/60 px-2 py-2">
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
      <td className="border-l border-border/60 px-2 py-2 text-muted-foreground">
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

      <td className="border-l border-border/60 px-2 py-2">
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

      <td className="border-l border-border/60 px-2 py-2">
        <PriorityCell task={task} canEdit={canEdit} run={run} t={t} />
      </td>

      <td
        className={cn(
          "border-l border-border/60 px-2 py-2 tabular-nums",
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
