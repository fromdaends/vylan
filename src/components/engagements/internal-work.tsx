"use client";

// THE task list. One component, both screens, every kind of task.
//
// It used to be one of two lists on a job: the kinds with screens (document
// collection, signatures, deliverables) were drawn by engagement-tabs.tsx, and
// the plain ones sat underneath in a dashed box of their own. The founder, on
// seeing that live: "remove the whole nothing planned on your side box on an
// assignment. It should come purely from the add task" and "the task view for a
// specific engagement when you click on a engagement is too barebones and
// doesnt match with the actual tasks screen."
//
// Both are the same bug. A task is a task; splitting them by kind put one
// screen's worth of work in two boxes with two different row designs, two empty
// states and two ways to add. Now there is one list, and a row that HAS a
// screen simply says so with a chevron.
//
// ── THE DASHED "OUR SIDE OF THE WALL" PANEL IS GONE ────────────────────────
//
// It was right when this list held only internal steps and sat beside three
// client-facing tabs. It is wrong now: the list holds the document collection
// too, which is the most client-facing thing on the page, so a border saying
// "the client never sees this" would have been false. The wall still exists
// where it always did — in the database and in the portal's route tree, which
// has no path to engagement_tasks and a test that fails if one appears.
//
// ── EVERY TASK HAS A NAME ──────────────────────────────────────────────────
//
// The founder: "every task should have an ctual name not just a broad
// tagline". So the big text is whatever the user typed, and the KIND is a
// small tag beside it. "Document collection" was never a name — it is a
// category, and twenty-eight rows of it told you nothing about any of them.
//
// STATUS IS A CLICK, NOT A MENU. Three states cycle on the box — empty, half,
// done. A dropdown for three values is a dropdown nobody opens.
//
// ── EVERYTHING IS OPTIMISTIC ───────────────────────────────────────────────
//
// The founder: "assigning someone a task takes so long super laggy". It was:
// every tick and every name went to the server, waited, then re-rendered the
// WHOLE page before the checkbox moved. On a job page that is a lot of work to
// redraw a 16px box. The change now lands on screen immediately and the server
// catches up behind it — useOptimistic holds the new value until the refresh
// it triggered has actually returned, so there is no flash back to the old one
// in between. If the write fails the value snaps back on its own and says so.

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  FileSignature,
  FolderCheck,
  Inbox,
  Minus,
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

type TaskStatus = "todo" | "doing" | "done";
export type WorkRow = {
  id: string;
  title: string;
  kind: string;
  status: TaskStatus;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  /** Only supplied on the firm-wide list. */
  clientName?: string | null;
  engagementTitle?: string | null;
  /** "2 of 3 done" for a kind that owns a collection. Job page only. */
  meta?: string;
  notes?: string | null;
  dueDate?: string | null;
};
type Person = { id: string; name: string };

// todo → doing → done → todo. One click moves you along; three bring you back,
// which is the whole reason it is a cycle and not a toggle.
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

type Patch =
  | { id: string; remove: true }
  | ({ id: string; remove?: false } & Partial<
      Pick<WorkRow, "status" | "assigneeIds" | "title" | "notes" | "dueDate">
    >);

export function InternalWork({
  tasks,
  members,
  canEdit,
  variant = "job",
  onOpen,
}: {
  tasks: WorkRow[];
  members: Person[];
  canEdit: boolean;
  /** "firm" adds the line saying which client and job each task belongs to. */
  variant?: "job" | "firm";
  /**
   * Opens a task that has a screen. Absent on the firm-wide list, where a row
   * links you to the job instead — the screens live on the job's page and
   * teleporting into one from a firm list would strand you there.
   */
  onOpen?: (taskId: string) => void;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Which task's panel is open. Client state — everything it shows is already
  // in the row, so a URL would cost a round trip to display what is on screen.
  const [detailId, setDetailId] = useState<string | null>(null);

  // The list as the user sees it: server truth with any in-flight change
  // already applied. Reverts by itself if the write fails.
  const [rows, patch] = useOptimistic(tasks, (state: WorkRow[], p: Patch) =>
    p.remove
      ? state.filter((r) => r.id !== p.id)
      : state.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
  );

  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const firmWide = variant === "firm";

  function run(p: Patch, call: () => Promise<TaskActionResult>) {
    startTransition(async () => {
      patch(p);
      const res = await call();
      if (res.ok) {
        // Re-fetch so the optimistic value is replaced by server truth rather
        // than merely agreeing with it. Inside the same transition, so React
        // holds the optimistic row until the fresh data lands.
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
          : null;

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t(firmWide ? "work_empty_firm" : "work_empty")}
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border/50">
      {rows.map((task) => {
        const assignees = task.assigneeIds
          .map((id) => ({ id, name: nameById.get(id) }))
          .filter((a): a is Person => Boolean(a.name));
        const Icon = KIND_ICON[task.kind];
        const label = kindLabel(task.kind);
        const openable = Boolean(onOpen && Icon);

        return (
          <li key={task.id} className="group flex items-center gap-3 py-2.5">
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
                "flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50",
                task.status === "done"
                  ? "border-foreground bg-foreground text-background"
                  : task.status === "doing"
                    ? "border-foreground/60 text-foreground/70"
                    : "border-border hover:border-foreground/50",
              )}
            >
              {task.status === "done" && <Check className="size-3.5" aria-hidden />}
              {task.status === "doing" && <Minus className="size-3.5" aria-hidden />}
            </button>

            {/* The kind's mark, for the kinds that are more than a line of
                text. A plain task has none, which is itself the signal. */}
            {Icon && (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
            )}

            <TaskName
              task={task}
              label={label}
              firmWide={firmWide}
              openable={openable}
              onOpenScreen={onOpen}
              onOpenDetail={() => setDetailId(task.id)}
              t={t}
            />

            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {assignees.length > 0 ? (
                      <>
                        {/* Faces, not names: two people on a task is the
                            ordinary case and two full names do not fit. */}
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
                <DropdownMenuContent align="end" className="w-52">
                  {members.map((m) => {
                    const on = task.assigneeIds.includes(m.id);
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={(e) => {
                          // Keep the menu open: putting two people on a task
                          // should not cost two trips to the same button.
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
              assignees.length > 0 && (
                <span className="flex shrink-0 items-center gap-1">
                  {assignees.slice(0, 3).map((a) => (
                    <AvatarInitials key={a.id} name={a.name} size={18} />
                  ))}
                </span>
              )
            )}

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
                // Appears on hover, like the row controls everywhere else in
                // this app. A delete icon on every row of a list of ninety is
                // ninety invitations to lose something.
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-[color,opacity] hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
      </ul>

      <TaskDetailPanel
        task={rows.find((r) => r.id === detailId) ?? null}
        members={members}
        canEdit={canEdit}
        kindLabel={kindLabel}
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
                }),
          );
        }}
      />
    </>
  );
}

/**
 * The name, the kind tag, and whatever context the screen owes you. Split out
 * because it is the one part that differs between the two screens, and the
 * openable row has to wrap it in a button while the plain one must not — a
 * button inside a button is invalid HTML that browsers silently rearrange.
 */
function TaskName({
  task,
  label,
  firmWide,
  openable,
  onOpenScreen,
  onOpenDetail,
  t,
}: {
  task: WorkRow;
  label: string | null;
  firmWide: boolean;
  openable: boolean;
  /** Present only where the task's own screen is reachable. */
  onOpenScreen?: (taskId: string) => void;
  onOpenDetail: () => void;
  t: ReturnType<typeof useTranslations<"Engagements">>;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate text-sm",
            task.status === "done" &&
              "text-muted-foreground line-through decoration-border",
          )}
        >
          {task.title}
        </span>
        {label && (
          <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        )}
      </span>
      {task.meta && (
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
          {task.meta}
        </span>
      )}
    </>
  );

  // TWO TARGETS, and they are different things on purpose. The NAME is about
  // the task — who is on it, when it is due, the note. The CHEVRON goes INTO
  // it, which is what a chevron has meant everywhere else in this app. Merging
  // them would mean either burying the checklist behind a panel or having no
  // way to reach a task's own fields.
  const name = (
    <button
      type="button"
      onClick={onOpenDetail}
      aria-label={t("task_open_detail", { title: task.title })}
      className="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  );

  if (openable) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {name}
        <button
          type="button"
          onClick={() => onOpenScreen?.(task.id)}
          aria-label={t("task_open", { title: task.title })}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      {name}
      {/* WHO IT IS FOR. Only on the firm-wide list: on a job every row has the
          same answer, and repeating it is noise. Rendered outside `body` so
          the links are never nested inside the open-the-screen button. */}
      {firmWide && (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          <Link
            href={`/clients/${task.clientId}`}
            className="hover:text-foreground hover:underline"
          >
            {task.clientName ?? "—"}
          </Link>
          {/* Skipped when it would only repeat the name above it. 1380 named
              each backfilled task after its own job, which is right on a job
              page and reads as a stutter here: "T2 Tax Return / ABC Inc · T2
              Tax Return". The client is the part that varies; keep that. */}
          {task.engagementId &&
            task.engagementTitle &&
            task.engagementTitle !== task.title && (
            <>
              {" · "}
              <Link
                href={`/engagements/${task.engagementId}`}
                className="hover:text-foreground hover:underline"
              >
                {task.engagementTitle}
              </Link>
            </>
            )}
        </span>
      )}
    </span>
  );
}
