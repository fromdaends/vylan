"use client";

// THE TASKS CARD — the hub of the engagement page (design 2a).
//
// Every task on the job is a row; the three STRUCTURAL kinds (document
// collection, signatures, deliverables) point at collections that live
// elsewhere, and clicking their row opens the floating task panel
// (task-artifact-panel.tsx) over this page. Plain rows cycle their checkbox
// and nothing else — the design gives them no door on purpose, and /work
// remains the place a task is edited in full.
//
// STATE LIVES HERE, not in the panel: the doc-request task's meta line
// ("1 of 4 approved · 1 to review") and the panel's progress bar must move
// together when a document is approved behind the panel, so both read the
// same optimistic item map. Same pattern for the checkbox cycle: local
// override first, updateTaskAction after, rollback on failure — the exact
// optimistic shape the assignees control uses.
//
// The checkbox reuses TaskStatusCheckbox (work/task-bits) — ONE drawing of
// the three-state box in the whole app — and the cycle writes the plain
// bucket (statusId cleared), which is what the tasks table's own bulk
// "mark done" writes.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import {
  NEXT_STATUS,
  TaskStatusCheckbox,
  TaskAssigneeMenu,
  DueIndicator,
  type Person,
  type TaskStatus,
} from "@/components/work/task-bits";
import { TaskKindIcon } from "@/components/engagements/task-kind-icon";
import {
  updateTaskAction,
  setTaskAssigneeAction,
} from "@/app/actions/engagement-tasks";
import {
  TaskArtifactPanel,
  type ArtifactPanelKind,
  type DocPanelItem,
  type SigPanelRow,
  type DelivPanelFile,
} from "@/components/engagements/task-artifact-panel";

export type HubTask = {
  id: string;
  title: string;
  kind: string;
  status: TaskStatus;
  dueDate: string | null;
  assigneeIds: string[];
  notes: string | null;
  subDone: number;
  subTotal: number;
  /** Which panel the row opens — null for a plain task. */
  panel: ArtifactPanelKind | null;
};

export function EngagementTaskHub({
  engagementId,
  tasks,
  items,
  signatures,
  deliverables,
  deliverablesLocked,
  invoiceNumber,
  clientName,
  portalUrl,
  reminderEveryDays,
  members,
  canEdit,
  locale,
  addTask,
  addDeliverable,
  preview,
  addItem,
  addSignature,
}: {
  engagementId: string;
  tasks: HubTask[];
  items: DocPanelItem[];
  signatures: SigPanelRow[];
  deliverables: DelivPanelFile[];
  deliverablesLocked: boolean;
  invoiceNumber: string | null;
  clientName: string | null;
  portalUrl: string | null;
  /** Reminder cadence in days when automatic reminders are on, else null. */
  reminderEveryDays: number | null;
  members: Person[];
  canEdit: boolean;
  locale: AppLocale;
  /** The AddTaskDialog, mounted by the page with a design-styled trigger. */
  addTask: React.ReactNode;
  /** AddFinalDocumentDialog with the panel's drop-zone trigger. */
  addDeliverable: React.ReactNode;
  /** EngagementPreview — the visual review of everything uploaded, on the
   *  card header beside Add task (founder request: out of the panel). */
  preview: React.ReactNode;
  /** AddItemDialog for the doc panel's progress row. */
  addItem: React.ReactNode;
  /** AddSignatureDialog for the signatures panel. */
  addSignature: React.ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic overrides, keyed by id. Empty map = trust the server props.
  const [statusOverride, setStatusOverride] = useState<
    Record<string, TaskStatus>
  >({});
  const [itemOverride, setItemOverride] = useState<Record<string, string>>({});
  const [assigneeOverride, setAssigneeOverride] = useState<
    Record<string, string[]>
  >({});
  const [openPanel, setOpenPanel] = useState<ArtifactPanelKind | null>(null);

  const statusOf = (task: HubTask): TaskStatus =>
    statusOverride[task.id] ?? task.status;

  const liveItems = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        status: (itemOverride[i.id] ?? i.status) as DocPanelItem["status"],
      })),
    [items, itemOverride],
  );

  function cycle(task: HubTask) {
    if (!canEdit) return;
    const from = statusOf(task);
    const to = NEXT_STATUS[from];
    setStatusOverride((prev) => ({ ...prev, [task.id]: to }));
    startTransition(async () => {
      const res = await updateTaskAction({
        taskId: task.id,
        engagementId,
        status: to,
        statusId: null,
      });
      if (!res.ok) {
        setStatusOverride((prev) => ({ ...prev, [task.id]: from }));
        toast.error(t("task_update_failed"));
        return;
      }
      router.refresh();
    });
  }

  function toggleAssignee(task: HubTask, userId: string, on: boolean) {
    const current = assigneeOverride[task.id] ?? task.assigneeIds;
    const next = on
      ? [...current, userId]
      : current.filter((id) => id !== userId);
    setAssigneeOverride((prev) => ({ ...prev, [task.id]: next }));
    startTransition(async () => {
      const res = await setTaskAssigneeAction({
        taskId: task.id,
        engagementId,
        userId,
        on,
      });
      if (!res.ok) {
        setAssigneeOverride((prev) => ({ ...prev, [task.id]: current }));
        toast.error(t("task_update_failed"));
        return;
      }
      router.refresh();
    });
  }

  function approveItem(itemId: string) {
    setItemOverride((prev) => ({ ...prev, [itemId]: "approved" }));
    // The server action call itself lives in the panel (it owns its buttons);
    // this is the shared optimistic write both surfaces read.
  }

  // The doc-request task's LIVE meta — recomputed from item states, so
  // approving inside the panel moves this line behind it. `na` lines are out
  // of the denominator, same as the roll-ups elsewhere.
  const docMeta = useMemo(() => {
    const counted = liveItems.filter((i) => i.status !== "na");
    const approved = counted.filter((i) => i.status === "approved").length;
    const toReview = counted.filter((i) => i.status === "submitted").length;
    const base = t("docs_meta_approved", {
      done: approved,
      total: counted.length,
    });
    return toReview > 0
      ? `${base} · ${t("docs_meta_review", { count: toReview })}`
      : base;
  }, [liveItems, t]);

  const sigMeta = useMemo(() => {
    if (signatures.length === 0) return null;
    const signed = signatures.filter((s) => s.state === "signed").length;
    return t("sigs_meta", { done: signed, total: signatures.length });
  }, [signatures, t]);

  const delivMeta = useMemo(() => {
    if (deliverables.length === 0) return t("deliv_meta_empty");
    return t("deliv_meta", {
      count: deliverables.length,
      state: deliverablesLocked
        ? t("deliv_meta_locked")
        : t("deliv_meta_unlocked"),
    });
  }, [deliverables, deliverablesLocked, t]);

  function metaFor(task: HubTask): string | null {
    if (task.kind === "document_collection") return docMeta;
    if (task.kind === "signatures") return sigMeta;
    if (task.kind === "deliverables") return delivMeta;
    return task.notes;
  }

  const done = tasks.filter((x) => statusOf(x) === "done").length;
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section
      className="rounded-[14px] border border-border bg-card shadow-card"
      aria-label={t("hub_tasks_title")}
    >
      <div className="flex items-center gap-2.5 px-[22px] py-4">
        <CheckCircle2 className="size-[17px] shrink-0 text-accent" aria-hidden />
        <h2 className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {t("hub_tasks_title")}
        </h2>
        {tasks.length > 0 && (
          <>
            <span className="text-xs font-medium text-muted-foreground">
              {t("task_progress", { done, total: tasks.length })}
            </span>
            <div
              className="h-1 w-[90px] overflow-hidden rounded-full bg-muted"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-[350ms] ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          {preview}
          {addTask}
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="border-t border-border/50 px-[22px] py-8 text-center text-sm text-muted-foreground">
          {t("hub_tasks_empty")}
        </p>
      ) : (
        <div className="px-[22px] pb-3.5">
          {tasks.map((task) => {
            const status = statusOf(task);
            const isDone = status === "done";
            const clickable = task.panel != null;
            const meta = metaFor(task);
            return (
              <div
                key={task.id}
                onClick={
                  clickable ? () => setOpenPanel(task.panel) : undefined
                }
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenPanel(task.panel);
                        }
                      }
                    : undefined
                }
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                className={cn(
                  "-mx-2.5 flex items-center gap-3 rounded-lg border-t border-border/50 px-2.5 py-3 transition-colors duration-150 hover:bg-secondary/60",
                  clickable &&
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {/* The checkbox never opens the panel — its click stops here. */}
                <span onClick={(e) => e.stopPropagation()}>
                  <TaskStatusCheckbox
                    status={status}
                    disabled={!canEdit}
                    onCycle={() => cycle(task)}
                    ariaLabel={t("task_mark_done", { title: task.title })}
                    className={cn(isDone && "animate-task-pop")}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-sm font-medium",
                      isDone &&
                        "text-muted-foreground line-through decoration-border",
                    )}
                  >
                    {task.title}
                  </div>
                  {meta && (
                    <div className="mt-px truncate text-xs text-muted-foreground">
                      {meta}
                    </div>
                  )}
                </div>
                <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <TaskKindIcon kind={task.kind} className="size-3" />
                  {t(`kind_${task.kind}`)}
                </span>
                {task.subTotal > 0 && (
                  <span className="flex-none rounded-full border border-border px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-muted-foreground">
                    {task.subDone}/{task.subTotal}
                  </span>
                )}
                <DueIndicator
                  dueDate={task.dueDate}
                  status={status}
                  className="ml-auto"
                />
                <span onClick={(e) => e.stopPropagation()}>
                  <TaskAssigneeMenu
                    assigneeIds={assigneeOverride[task.id] ?? task.assigneeIds}
                    members={members}
                    canEdit={canEdit}
                    onToggle={(userId, on) => toggleAssignee(task, userId, on)}
                    unassignedLabel={t("task_assignee_none")}
                    avatarSize={22}
                  />
                </span>
                {clickable ? (
                  <ArrowUpRight
                    className="size-3.5 flex-none text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <span className="w-3.5 flex-none" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      )}

      <TaskArtifactPanel
        kind={openPanel}
        onClose={() => setOpenPanel(null)}
        engagementId={engagementId}
        title={
          openPanel
            ? (tasks.find(
                (x) =>
                  x.kind ===
                  (openPanel === "docs"
                    ? "document_collection"
                    : openPanel === "signatures"
                      ? "signatures"
                      : "deliverables"),
              )?.title ?? "")
            : ""
        }
        items={liveItems}
        onApproved={approveItem}
        signatures={signatures}
        deliverables={deliverables}
        deliverablesLocked={deliverablesLocked}
        invoiceNumber={invoiceNumber}
        clientName={clientName}
        portalUrl={portalUrl}
        reminderEveryDays={reminderEveryDays}
        canEdit={canEdit}
        locale={locale}
        addDeliverable={addDeliverable}
        addItem={addItem}
        addSignature={addSignature}
      />
    </section>
  );
}
