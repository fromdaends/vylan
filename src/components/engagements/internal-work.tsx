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
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  FileSignature,
  FolderCheck,
  Inbox,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DueIndicator,
  NEXT_STATUS as NEXT,
  TaskAssigneeMenu,
  TaskStatusCheckbox,
  TaskWhoFor,
  type Person,
  type TaskStatus,
} from "@/components/work/task-bits";
import {
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneeAction,
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";
import { TaskDetailPanel } from "@/components/engagements/task-detail-panel";

export type WorkRow = {
  id: string;
  title: string;
  kind: string;
  status: TaskStatus;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  /** YYYY-MM-DD, or null for "whenever". Drawn by DueIndicator on the row
   *  (design 2a) and edited in the detail panel (#1233). */
  dueDate?: string | null;
  /** Only supplied on the firm-wide list. */
  clientName?: string | null;
  engagementTitle?: string | null;
  /** "2 of 3 done" for a kind that owns a collection. Job page only. */
  meta?: string;
  /** Free text on the task, edited in the detail panel. */
  notes?: string | null;
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
  today,
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
  /** Today (YYYY-MM-DD) in the FIRM's timezone, for the due labels. Optional:
   *  without it DueIndicator falls back to the viewer's clock. */
  today?: string;
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
        const Icon = KIND_ICON[task.kind];
        const label = kindLabel(task.kind);
        const openable = Boolean(onOpen && Icon);

        return (
          <li key={task.id} className="group flex items-center gap-3 py-2.5">
            <TaskStatusCheckbox
              status={task.status}
              disabled={!canEdit}
              onCycle={() =>
                run({ id: task.id, status: NEXT[task.status] }, () =>
                  updateTaskAction({
                    taskId: task.id,
                    engagementId: task.engagementId,
                    status: NEXT[task.status],
                  }),
                )
              }
              ariaLabel={t("work_toggle", { title: task.title })}
            />

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

            <DueIndicator
              dueDate={task.dueDate}
              status={task.status}
              today={today}
            />

            <TaskAssigneeMenu
              assigneeIds={task.assigneeIds}
              members={members}
              canEdit={canEdit}
              unassignedLabel={t("work_unassigned")}
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
        <TaskWhoFor
          clientId={task.clientId}
          clientName={task.clientName}
          engagementId={task.engagementId}
          engagementTitle={task.engagementTitle}
          // Lets the shared line skip an engagement title that only repeats
          // the task's own name (#1233's stutter rule, now everywhere).
          taskTitle={task.title}
          className="mt-0.5"
        />
      )}
    </span>
  );
}
