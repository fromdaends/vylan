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
  FileSignature,
  FolderCheck,
  Inbox,
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

const KIND_ICON: Record<string, typeof Inbox> = {
  document_collection: Inbox,
  signatures: FileSignature,
  deliverables: FolderCheck,
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
const VIEWS: TaskView[] = ["active", "mine", "unassigned", "done", "all"];

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

  const kindLabel = (kind: string) =>
    kind === "document_collection"
      ? t("kind_document_collection")
      : kind === "signatures"
        ? t("kind_signatures")
        : kind === "deliverables"
          ? t("kind_deliverables")
          : t("kind_task");

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
  }, [rows, view, sort, kindFilter, assigneeFilter, priorityFilter, nameById]);

  const kinds = useMemo(
    () => [...new Set(rows.map((r) => r.kind))].sort(),
    [rows],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));

  const filtersOn =
    kindFilter.length > 0 || assigneeFilter.length > 0 || priorityFilter.length > 0;

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

      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu
          label={t("col_kind")}
          accessibleName={t("filter_by", { label: t("col_kind") })}
          selected={kindFilter}
          onChange={setKindFilter}
          options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))}
        />
        <FilterMenu
          label={t("col_assignee")}
          accessibleName={t("filter_by", { label: t("col_assignee") })}
          selected={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { value: "none", label: t("work_unassigned") },
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <FilterMenu
          label={t("col_priority")}
          accessibleName={t("filter_by", { label: t("col_priority") })}
          selected={priorityFilter}
          onChange={(v) => setPriorityFilter(v as TaskPriority[])}
          options={(["high", "medium", "low", "none"] as TaskPriority[]).map(
            (p) => ({ value: p, label: t(`priority_${p}` as "priority_none") }),
          )}
        />
        {filtersOn && (
          <button
            type="button"
            onClick={() => {
              setKindFilter([]);
              setAssigneeFilter([]);
              setPriorityFilter([]);
            }}
            className="rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {t("filters_clear")}
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {t("task_count_total", { count: shown.length })}
        </span>
      </div>

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
                <Th
                  label={t("col_status")}
                  active={sort.key === "status"}
                  desc={sort.desc}
                  onClick={() => toggleSort("status")}
                  className="w-[132px]"
                />
                <Th
                  label={t("col_task")}
                  active={sort.key === "title"}
                  desc={sort.desc}
                  onClick={() => toggleSort("title")}
                />
                {firmWide && (
                  <Th
                    label={t("col_client")}
                    active={sort.key === "client"}
                    desc={sort.desc}
                    onClick={() => toggleSort("client")}
                    className="w-[180px]"
                  />
                )}
                <Th
                  label={t("col_kind")}
                  active={sort.key === "kind"}
                  desc={sort.desc}
                  onClick={() => toggleSort("kind")}
                  className="w-[160px]"
                />
                <Th
                  label={t("col_assignee")}
                  active={sort.key === "assignee"}
                  desc={sort.desc}
                  onClick={() => toggleSort("assignee")}
                  className="w-[140px]"
                />
                <Th
                  label={t("col_priority")}
                  active={sort.key === "priority"}
                  desc={sort.desc}
                  onClick={() => toggleSort("priority")}
                  className="w-[110px]"
                />
                <Th
                  label={t("col_due")}
                  active={sort.key === "due"}
                  desc={sort.desc}
                  onClick={() => toggleSort("due")}
                  className="w-[110px]"
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

function Th({
  label,
  active,
  desc,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={cn("group/th px-2 py-2 font-medium", className)}>
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        {active ? (
          desc ? (
            <ArrowDown className="size-3" aria-hidden />
          ) : (
            <ArrowUp className="size-3" aria-hidden />
          )
        ) : (
          // Shown only on hover: eight permanent sort arrows is eight pieces of
          // furniture saying nothing about the data underneath them.
          <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-100" aria-hidden />
        )}
      </button>
    </th>
  );
}

function FilterMenu({
  label,
  accessibleName,
  options,
  selected,
  onChange,
}: {
  label: string;
  /** "Filter by Task type" — the visible chip says only "Task type", which is
   *  also the name of a column header, so on its own it is ambiguous to anyone
   *  navigating by control name. */
  accessibleName: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={accessibleName}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected.length > 0
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {selected.length > 0 && (
            <span className="tabular-nums">{selected.length}</span>
          )}
          <ChevronsUpDown className="size-3 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            // Stays open: narrowing to three people should not cost three trips
            // to the same button.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) =>
              onChange(
                on
                  ? [...selected, o.value]
                  : selected.filter((x) => x !== o.value),
              )
            }
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const Icon = KIND_ICON[task.kind];
  const openable = Boolean(onOpenScreen && Icon);
  const overdue =
    task.dueDate && task.status !== "done" && task.dueDate < today();

  return (
    <tr className="group border-b border-border/50 transition-colors hover:bg-muted/40">
      <td className="px-2 py-2">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            run({ id: task.id, status: NEXT[task.status] }, () =>
              updateTaskAction({
                taskId: task.id,
                engagementId: task.engagementId,
                status: NEXT[task.status],
              }),
            )
          }
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
            onClick={onOpenDetail}
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
              onClick={() => onOpenScreen?.(task.id)}
              aria-label={t("task_open", { title: task.title })}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </td>

      {firmWide && (
        <td className="px-2 py-2">
          <Link
            href={`/clients/${task.clientId}`}
            className="block truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            {task.clientName ?? "—"}
          </Link>
        </td>
      )}

      <td className="px-2 py-2 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{kindLabel(task.kind)}</span>
        </span>
      </td>

      <td className="px-2 py-2">
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
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
            onClick={() =>
              run({ id: task.id, remove: true }, () =>
                deleteTaskAction({
                  taskId: task.id,
                  engagementId: task.engagementId,
                }),
              )
            }
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
