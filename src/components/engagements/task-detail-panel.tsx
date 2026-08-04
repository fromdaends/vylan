"use client";

// One task, opened.
//
// The founder asked for assigning to be "more in depth" and picked this shape
// over a richer dropdown: the row stays a fast tick-and-assign, and everything
// that does not fit on a row lives here — who is on it, when it is due, what
// state it is in, and any note about it.
//
// It is the same split Canopy uses and the reason is the same: a task list is
// scanned, a task is read. Loading a row with four controls makes the list
// worse at the thing it is for.
//
// ── WHAT OPENS WHAT ────────────────────────────────────────────────────────
//
// The NAME opens this. The CHEVRON opens the task's own screen, where it has
// one. Two targets on one row, which is only acceptable because they are
// visibly different things — a chevron has meant "go in" everywhere else in
// this app, and a name has meant "this thing".
//
// A task with a screen also gets a button in here that opens it, so the panel
// is never a dead end for the most common thing you would want next.
//
// ── EVERY EDIT IS OPTIMISTIC, AND OWNED BY THE LIST ────────────────────────
//
// This component holds NO server state of its own. It is handed the row and a
// `patch` callback, and the list it came from does the optimistic update and
// the write — the same path the row's own checkbox uses. Two components each
// writing the same task is how a panel and a row start disagreeing about
// whether something is done.
//
// The text fields are the exception, and only in the shallow way: they keep a
// local draft while you type and commit on blur, because sending a write per
// keystroke is the lag the founder just had removed.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Check, ExternalLink, Minus, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type TaskStatus = "todo" | "doing" | "done";
type TaskPriority = "none" | "low" | "medium" | "high";
type Person = { id: string; name: string };

export type DetailTask = {
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
  meta?: string;
};

const STATUSES: TaskStatus[] = ["todo", "doing", "done"];
const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high"];

export type TaskDetailPanelPatch = (
  patch: {
    title?: string;
    notes?: string | null;
    status?: TaskStatus;
    dueDate?: string | null;
    priority?: TaskPriority;
    assigneeIds?: string[];
  },
  /** What to send the server. Kept separate because toggling one person is one
   *  call, while the optimistic value is the whole new list. */
  call: { assigneeId?: string; on?: boolean },
) => void;

export function TaskDetailPanel({
  task,
  members,
  canEdit,
  kindLabel,
  onClose,
  onOpenScreen,
  onPatch,
}: {
  /** Null when nothing is open. The sheet stays mounted either way. */
  task: DetailTask | null;
  members: Person[];
  canEdit: boolean;
  /** The kind's display name, or null for a plain task. */
  kindLabel: (kind: string) => string | null;
  onClose: () => void;
  /** Present only where the task's screen is reachable from here. */
  onOpenScreen?: (taskId: string) => void;
  onPatch: TaskDetailPanelPatch;
}) {
  return (
    <Sheet open={Boolean(task)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {task && (
          // KEYED BY THE TASK. The name and notes fields keep a local draft
          // while you type, and a draft has to be re-seeded when a different
          // task is opened. Remounting on the id does that for free — doing it
          // in an effect means a render with the previous task's text in it,
          // and eslint rejects setState in an effect for exactly that reason.
          <DetailBody
            key={task.id}
            task={task}
            members={members}
            canEdit={canEdit}
            kindLabel={kindLabel}
            onClose={onClose}
            onOpenScreen={onOpenScreen}
            onPatch={onPatch}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  task,
  members,
  canEdit,
  kindLabel,
  onClose,
  onOpenScreen,
  onPatch,
}: {
  task: DetailTask;
  members: Person[];
  canEdit: boolean;
  kindLabel: (kind: string) => string | null;
  onClose: () => void;
  onOpenScreen?: (taskId: string) => void;
  onPatch: TaskDetailPanelPatch;
}) {
  const t = useTranslations("Engagements");
  // The three status words already exist under Clients, in both locales, with
  // exactly this meaning. Reused rather than copied — two namespaces holding
  // the same string is how one of them ends up stale.
  const tStatus = useTranslations("Clients");

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");

  const label = kindLabel(task.kind);
  const assignees = task.assigneeIds
    .map((id) => ({ id, name: members.find((m) => m.id === id)?.name }))
    .filter((a): a is Person => Boolean(a.name));

  return (
          <>
            <SheetHeader className="gap-1.5">
              {label && (
                <span className="w-fit rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
              )}
              <SheetTitle className="sr-only">{task.title}</SheetTitle>
              {/* The name is the heading AND the field — renaming a task
                  should not need a separate edit mode for a single line. */}
              <Input
                value={title}
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  const next = title.trim();
                  if (next && next !== task.title) onPatch({ title: next }, {});
                  else setTitle(task.title);
                }}
                aria-label={t("add_task_name")}
                className="h-auto border-0 bg-transparent px-0 text-lg font-semibold tracking-tight shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <SheetDescription className="text-xs">
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
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
              {onOpenScreen && label && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-between"
                  onClick={() => {
                    onOpenScreen(task.id);
                    onClose();
                  }}
                >
                  {t("task_open_screen", { kind: label })}
                  <ExternalLink className="size-4" aria-hidden />
                </Button>
              )}

              <Field label={t("task_status")}>
                <div className="flex gap-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onPatch({ status: s }, {})}
                      aria-pressed={task.status === s}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
                        task.status === s
                          ? "border-foreground/30 bg-secondary font-medium text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {s === "done" && <Check className="size-3" aria-hidden />}
                      {s === "doing" && <Minus className="size-3" aria-hidden />}
                      {tStatus(`task_status_${s}` as "task_status_todo")}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("task_assignees")}>
                <div className="flex flex-col gap-0.5">
                  {members.map((m) => {
                    const on = task.assigneeIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() =>
                          onPatch(
                            {
                              assigneeIds: on
                                ? task.assigneeIds.filter((x) => x !== m.id)
                                : [...task.assigneeIds, m.id],
                            },
                            { assigneeId: m.id, on: !on },
                          )
                        }
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        <AvatarInitials name={m.name} size={20} />
                        <span className="truncate">{m.name}</span>
                      </button>
                    );
                  })}
                  {assignees.length === 0 && (
                    <p className="flex items-center gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
                      <UserPlus className="size-3.5" aria-hidden />
                      {t("work_unassigned")}
                    </p>
                  )}
                </div>
              </Field>

              <Field label={t("col_priority")}>
                <div className="flex gap-1">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onPatch({ priority: p }, {})}
                      aria-pressed={task.priority === p}
                      className={cn(
                        "flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
                        task.priority === p
                          ? "border-foreground/30 bg-secondary font-medium text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {t(`priority_${p}` as "priority_none")}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("task_due")}>
                <Input
                  type="date"
                  disabled={!canEdit}
                  value={task.dueDate ?? ""}
                  // A date picker commits on change, not on blur: there is no
                  // half-typed date worth debouncing.
                  onChange={(e) =>
                    onPatch({ dueDate: e.target.value || null }, {})
                  }
                  className="w-full"
                />
              </Field>

              <Field label={t("task_notes")}>
                <Textarea
                  rows={5}
                  disabled={!canEdit}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => {
                    const next = notes.trim();
                    if (next !== (task.notes ?? "")) {
                      onPatch({ notes: next || null }, {});
                    }
                  }}
                  placeholder={t("task_notes_placeholder")}
                />
              </Field>
            </div>
          </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
