"use client";

// The steps inside one task.
//
// The last structural gap against Canopy's model, and the only one of their six
// object types Vylan did not already have under another name. A Client Request,
// an Organizer and an eSignature are all request_items with a kind, living
// inside a document request; a SUBTASK is genuinely new — a step under a
// parent, with its own owner and its own due date.
//
// ── WHY IT LIVES IN THE PANEL AND NOT ON THE TABLE ─────────────────────────
//
// A task list is SCANNED. Nesting rows inside it would mean a hundred-row table
// where the indentation carries meaning, sorting by due date shuffles children
// away from parents, and "3 of 7" stops being answerable. Every product that
// tried it ends up with a tree nobody can filter.
//
// So the table shows a parent and a count; the panel is where the steps are.
// The count is the link between them: "2 of 5" on the row, the five here.
//
// ── ONE LEVEL ──────────────────────────────────────────────────────────────
//
// A subtask has no subtasks. The database refuses it (1430) rather than this
// component merely not offering it — a rule enforced only in the UI is a rule
// that lasts until the next caller.

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, Plus, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addTaskAction,
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneeAction,
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";

type Bucket = "todo" | "doing" | "done";
export type Subtask = {
  id: string;
  title: string;
  status: Bucket;
  statusId?: string | null;
  assigneeIds: string[];
  dueDate?: string | null;
};
type Person = { id: string; name: string };
type Status = { id: string; name: string; color: string; bucket: Bucket };

type Patch =
  | { id: string; remove: true }
  | ({ id: string; remove?: false } & Partial<Subtask>);

export function SubtaskList({
  parentId,
  parentClientId,
  parentEngagementId,
  subtasks,
  members,
  statuses,
  canEdit,
}: {
  parentId: string;
  parentClientId: string;
  parentEngagementId: string | null;
  subtasks: Subtask[];
  members: Person[];
  statuses: Status[];
  canEdit: boolean;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [rows, patch] = useOptimistic(subtasks, (state: Subtask[], p: Patch) =>
    p.remove
      ? state.filter((r) => r.id !== p.id)
      : state.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
  );

  const doneStatus = statuses.find((s) => s.bucket === "done");
  const todoStatus = statuses.find((s) => s.bucket === "todo");
  const done = rows.filter((r) => r.status === "done").length;

  function run(p: Patch, call: () => Promise<TaskActionResult>) {
    startTransition(async () => {
      patch(p);
      const res = await call();
      if (res.ok) {
        router.refresh();
        return;
      }
      toast.error(res.needsMigration ? t("work_needs_migration") : t("work_failed"));
    });
  }

  async function add() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const res = await addTaskAction({
        // Sent for completeness; a trigger copies them from the parent anyway,
        // so a subtask can never end up filed against a different client.
        clientId: parentClientId,
        engagementId: parentEngagementId,
        title,
        parentId,
      });
      if (res.ok) {
        setDraft("");
        startTransition(() => router.refresh());
      } else {
        toast.error(
          res.error === "bad_title" ? t("work_bad_title") : t("work_failed"),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t("subtasks")}
        </span>
        {rows.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("work_progress", { done, total: rows.length })}
          </span>
        )}
      </div>

      <ul className="flex flex-col">
        {rows.map((sub) => {
          const isDone = sub.status === "done";
          const assignees = sub.assigneeIds
            .map((id) => ({ id, name: members.find((m) => m.id === id)?.name }))
            .filter((a): a is Person => Boolean(a.name));
          return (
            <li key={sub.id} className="group flex items-center gap-2 py-1">
              <button
                type="button"
                disabled={!canEdit || !doneStatus || !todoStatus}
                onClick={() => {
                  const next = isDone ? todoStatus : doneStatus;
                  if (!next) return;
                  run({ id: sub.id, status: next.bucket, statusId: next.id }, () =>
                    updateTaskAction({
                      taskId: sub.id,
                      engagementId: parentEngagementId,
                      statusId: next.id,
                    }),
                  );
                }}
                aria-label={t("task_mark_done", { title: sub.title })}
                aria-pressed={isDone}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-40",
                  isDone
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:border-foreground/60",
                )}
              >
                {isDone && <Check className="size-2.5" aria-hidden />}
              </button>

              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  isDone && "text-muted-foreground line-through decoration-border",
                )}
              >
                {sub.title}
              </span>

              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {assignees.length > 0 ? (
                        assignees.slice(0, 2).map((a) => (
                          <AvatarInitials key={a.id} name={a.name} size={16} />
                        ))
                      ) : (
                        <UserPlus className="size-3" aria-hidden />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {members.map((m) => {
                      const on = sub.assigneeIds.includes(m.id);
                      return (
                        <DropdownMenuItem
                          key={m.id}
                          className="gap-2"
                          onSelect={(e) => {
                            e.preventDefault();
                            run(
                              {
                                id: sub.id,
                                assigneeIds: on
                                  ? sub.assigneeIds.filter((x) => x !== m.id)
                                  : [...sub.assigneeIds, m.id],
                              },
                              () =>
                                setTaskAssigneeAction({
                                  taskId: sub.id,
                                  userId: m.id,
                                  on: !on,
                                  engagementId: parentEngagementId,
                                }),
                            );
                          }}
                        >
                          <span
                            className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                              on
                                ? "border-foreground bg-foreground text-background"
                                : "border-border",
                            )}
                          >
                            {on && <Check className="size-2.5" aria-hidden />}
                          </span>
                          <AvatarInitials name={m.name} size={16} />
                          {m.name}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    run({ id: sub.id, remove: true }, () =>
                      deleteTaskAction({
                        taskId: sub.id,
                        engagementId: parentEngagementId,
                      }),
                    )
                  }
                  aria-label={t("work_delete", { title: sub.title })}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="relative">
          <Plus
            className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            // A single field, not the full create dialog. A step under a task
            // inherits its client and its job, so the only thing left to say is
            // what it is — and asking six questions to add "Review the W-2s"
            // is how a checklist stops being used.
            placeholder={t("subtasks_add_placeholder")}
            aria-label={t("subtasks_add_placeholder")}
            className="h-8 bg-background pl-7 text-[13px]"
          />
        </div>
      )}
    </div>
  );
}
