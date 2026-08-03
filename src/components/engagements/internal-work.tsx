"use client";

// OUR side of the wall — the firm's own steps on a job.
//
// The roadmap calls this "the most consequential UI decision in the plan", and
// it is right. The job page's other three tabs are all about documents moving
// between the firm and the client. This one is the only thing on the page the
// client will never see, and if it reads like a fourth checklist people will
// treat it as one — the separation would hold in the database and collapse in
// practice, which is the worse of the two failures because nobody notices.
//
// So it is drawn differently ON PURPOSE, and every difference is doing a job:
//
//   * a dashed border, where every other section on the page is solid — the
//     universal "this is not the same kind of thing" signal
//   * a muted, slightly inset panel instead of the page's card white
//   * one line at the top saying, in words, that the client cannot see it
//
// None of that is decoration; it is all the same sentence said three ways,
// because a person scanning a page reads the shape before they read the text.
//
// STATUS IS A CLICK, NOT A MENU. Three states cycle on the checkbox — empty,
// half, done — so ticking something off is one gesture. A dropdown for three
// values is a dropdown nobody opens.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
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
  type TaskActionResult,
} from "@/app/actions/engagement-tasks";

type TaskStatus = "todo" | "doing" | "done";
type Task = {
  id: string;
  title: string;
  assignedUserId: string | null;
  status: TaskStatus;
};
type Person = { id: string; name: string };

// todo -> doing -> done -> todo. One click moves you along; three clicks bring
// you back, which is the whole reason it is a cycle and not a toggle.
const NEXT: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export function InternalWork({
  engagementId,
  tasks,
  members,
  canEdit,
}: {
  engagementId: string;
  tasks: Task[];
  members: Person[];
  canEdit: boolean;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const nameById = new Map(members.map((m) => [m.id, m.name]));

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
    if (!title || busy) return;
    setBusy("new");
    try {
      if (report(await addTaskAction({ engagementId, title }))) setDraft("");
    } finally {
      setBusy(null);
    }
  }

  async function cycle(task: Task) {
    setBusy(task.id);
    try {
      report(
        await updateTaskAction({
          engagementId,
          taskId: task.id,
          status: NEXT[task.status],
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function assign(taskId: string, userId: string | null) {
    setBusy(taskId);
    try {
      report(
        await updateTaskAction({ engagementId, taskId, assignedUserId: userId }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(taskId: string) {
    setBusy(taskId);
    try {
      report(await deleteTaskAction({ engagementId, taskId }));
    } finally {
      setBusy(null);
    }
  }

  const done = tasks.filter((x) => x.status === "done").length;

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      {/* Said in words as well as in shape. Somebody who has just been added to
          this firm has no reason to know which lists the client can read. */}
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <EyeOff className="size-3.5 shrink-0" aria-hidden />
        {t("work_private_note")}
        {tasks.length > 0 && (
          <span className="ml-auto shrink-0 tabular-nums">
            {t("work_progress", { done, total: tasks.length })}
          </span>
        )}
      </p>

      {tasks.length === 0 && !canEdit && (
        <p className="py-4 text-sm text-muted-foreground">{t("work_empty")}</p>
      )}

      <ul className="divide-y divide-border/50">
        {tasks.map((task) => {
          const assignee = task.assignedUserId
            ? nameById.get(task.assignedUserId)
            : null;
          return (
            <li key={task.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                disabled={!canEdit || busy === task.id}
                onClick={() => cycle(task)}
                aria-label={t("work_toggle", { title: task.title })}
                className={`flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50 ${
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

              <span
                className={`min-w-0 flex-1 text-sm ${
                  task.status === "done"
                    ? "text-muted-foreground line-through decoration-border"
                    : ""
                }`}
              >
                {task.title}
              </span>

              {canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={busy === task.id}
                      className="flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {assignee ? (
                        <>
                          <AvatarInitials name={assignee} size={18} />
                          <span className="max-w-[8rem] truncate">
                            {assignee}
                          </span>
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
                    <DropdownMenuItem onSelect={() => assign(task.id, null)}>
                      {t("work_unassigned")}
                    </DropdownMenuItem>
                    {members.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={() => assign(task.id, m.id)}
                        className="gap-2"
                      >
                        <AvatarInitials name={m.name} size={18} />
                        {m.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                assignee && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <AvatarInitials name={assignee} size={18} />
                    {assignee}
                  </span>
                )
              )}

              {canEdit && (
                <button
                  type="button"
                  disabled={busy === task.id}
                  onClick={() => remove(task.id)}
                  aria-label={t("work_delete", { title: task.title })}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
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
