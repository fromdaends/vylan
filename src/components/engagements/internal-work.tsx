"use client";

// The firm's own work — ONE list, used in two places.
//
// On a job it shows that job's steps, drawn as "our side of the wall". On /work
// it shows every task in the firm and adds a line saying who each one is for.
// Same component, one prop apart, because two copies of a task list is exactly
// how two screens start disagreeing about what "done" looks like.
//
// ── WHY IT IS DRAWN APART FROM THE REST OF A JOB ────────────────────────────
//
// The job page's other three tabs are all about documents moving between the
// firm and the client. This is the only thing on that page the client never
// sees, and if it read like a fourth checklist people would treat it as one —
// the separation would hold in the database and collapse in practice, which is
// the worse failure because nobody notices.
//
// So on a job: a dashed border where everything else is solid, a muted inset
// panel, and one line saying in words that the client cannot see it. Three ways
// of saying the same thing, because people read shape before text.
//
// STATUS IS A CLICK, NOT A MENU. Three states cycle on the box — empty, half,
// done. A dropdown for three values is a dropdown nobody opens.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, EyeOff, Minus, Plus, Trash2, UserPlus } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
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

type TaskStatus = "todo" | "doing" | "done";
export type WorkRow = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeIds: string[];
  clientId: string;
  engagementId: string | null;
  /** Only supplied on the firm-wide list. */
  clientName?: string | null;
  engagementTitle?: string | null;
};
type Person = { id: string; name: string };

// todo → doing → done → todo. One click moves you along; three bring you back,
// which is the whole reason it is a cycle and not a toggle.
const NEXT: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export function InternalWork({
  tasks,
  members,
  canEdit,
  clientId,
  engagementId = null,
  variant = "job",
}: {
  tasks: WorkRow[];
  members: Person[];
  canEdit: boolean;
  /** Which client a NEW task is for. Absent on the firm-wide list, where the
   *  quick-add is not offered — a task needs a client and that list spans all
   *  of them. */
  clientId?: string;
  engagementId?: string | null;
  /** "job" draws the wall; "firm" is a plain list with a context line. */
  variant?: "job" | "firm";
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const firmWide = variant === "firm";

  function report(res: TaskActionResult) {
    if (res.ok) {
      startTransition(() => router.refresh());
      return true;
    }
    toast.error(
      res.needsMigration
        ? t("work_needs_migration")
        : res.error === "bad_title"
          ? t("work_bad_title")
          : t("work_failed"),
    );
    return false;
  }

  async function add() {
    const title = draft.trim();
    if (!title || busy || !clientId) return;
    setBusy("new");
    try {
      if (report(await addTaskAction({ clientId, engagementId, title }))) {
        setDraft("");
      }
    } finally {
      setBusy(null);
    }
  }

  async function cycle(task: WorkRow) {
    setBusy(task.id);
    try {
      report(
        await updateTaskAction({
          taskId: task.id,
          engagementId: task.engagementId,
          status: NEXT[task.status],
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleAssignee(task: WorkRow, userId: string) {
    setBusy(task.id);
    try {
      report(
        await setTaskAssigneeAction({
          taskId: task.id,
          userId,
          on: !task.assigneeIds.includes(userId),
          engagementId: task.engagementId,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(task: WorkRow) {
    setBusy(task.id);
    try {
      report(
        await deleteTaskAction({
          taskId: task.id,
          engagementId: task.engagementId,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  const done = tasks.filter((x) => x.status === "done").length;

  return (
    <div
      className={
        firmWide
          ? ""
          : "rounded-xl border border-dashed border-border bg-muted/30 p-4"
      }
    >
      {/* On a job, said in words as well as in shape — somebody just added to
          the firm has no reason to know which lists the client can read. */}
      {!firmWide && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <EyeOff className="size-3.5 shrink-0" aria-hidden />
          {t("work_private_note")}
          {tasks.length > 0 && (
            <span className="ml-auto shrink-0 tabular-nums">
              {t("work_progress", { done, total: tasks.length })}
            </span>
          )}
        </p>
      )}

      {tasks.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          {/* "Nothing planned on your side yet" is written for a job, where the
              other side is the client. On the firm-wide list there is no other
              side — it is the whole firm — so the sentence had to be its own. */}
          {t(firmWide ? "work_empty_firm" : "work_empty")}
        </p>
      )}

      <ul className="divide-y divide-border/50">
        {tasks.map((task) => {
          const assignees = task.assigneeIds
            .map((id) => ({ id, name: nameById.get(id) }))
            .filter((a): a is Person => Boolean(a.name));
          return (
            <li key={task.id} className="flex items-start gap-3 py-2">
              <button
                type="button"
                disabled={!canEdit || busy === task.id}
                onClick={() => cycle(task)}
                aria-label={t("work_toggle", { title: task.title })}
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50 ${
                  task.status === "done"
                    ? "border-foreground bg-foreground text-background"
                    : task.status === "doing"
                      ? "border-foreground/60 text-foreground/70"
                      : "border-border hover:border-foreground/50"
                }`}
              >
                {task.status === "done" && (
                  <Check className="size-3.5" aria-hidden />
                )}
                {task.status === "doing" && (
                  <Minus className="size-3.5" aria-hidden />
                )}
              </button>

              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm ${
                    task.status === "done"
                      ? "text-muted-foreground line-through decoration-border"
                      : ""
                  }`}
                >
                  {task.title}
                </span>
                {/* WHO IT IS FOR. Only on the firm-wide list: on a job every
                    row has the same answer, and repeating it is noise. */}
                {firmWide && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    <Link
                      href={`/clients/${task.clientId}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {task.clientName ?? "—"}
                    </Link>
                    {task.engagementId && task.engagementTitle && (
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

              {canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={busy === task.id}
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
                            toggleAssignee(task, m.id);
                          }}
                          className="gap-2"
                        >
                          <span
                            className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
                              on
                                ? "border-foreground bg-foreground text-background"
                                : "border-border"
                            }`}
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
                  disabled={busy === task.id}
                  onClick={() => remove(task)}
                  aria-label={t("work_delete", { title: task.title })}
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Quick-add only where a new task has an obvious client. The firm-wide
          list spans every client, so it cannot guess one. */}
      {canEdit && clientId && (
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t("work_add_placeholder")}
            aria-label={t("work_add_placeholder")}
            className="h-8 flex-1 bg-background text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 shrink-0"
            disabled={!draft.trim() || busy === "new"}
            onClick={add}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("work_add")}
          </Button>
        </div>
      )}
    </div>
  );
}
