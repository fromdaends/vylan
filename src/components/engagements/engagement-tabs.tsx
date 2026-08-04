"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, FileSignature, FolderCheck, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

// An engagement's WORK, as a list of tasks.
//
// This used to be a tab strip: Checklist | Signatures | Final documents, three
// views of one screen. The founder's correction, after a Canopy teardown:
//
//   "the task view is its own view. Like Signatures and final documents are
//    just tasks that you can do alongside document collection. But there can be
//    other tasks too either like preset ones or custom ones."
//
// Which is the right model and the tab strip was hiding it. An engagement is
// the CONTRACT — everything agreed with the client — and the things inside it
// are tasks: collect the documents, get the signatures, deliver the finals,
// reconcile the trial balance, call the CRA. Collecting documents is one of
// them, not the frame the others hang off.
//
// So this opens on the LIST — and the list is EMPTY until somebody makes
// something. The founder, on the three hardcoded rows this shipped with an
// hour earlier: "it shouldn't be, like, a fill out, like, do these three tasks.
// It should be empty until the user goes and creates a task."
//
// The difference is between a list and a form. Checklist / Signatures /
// Deliverables were three VIEWS of one engagement rendered as rows, so they
// appeared on every job whether or not anybody wanted them. They are now real
// task records (1370) with a KIND, and a job with none of them shows none.
//
// A task whose kind has a screen opens it. A plain task does not — a title,
// some owners and a checkbox is the whole of it.
//
// ── NO DATA CHANGED FOR THIS ────────────────────────────────────────────────
//
// Signatures and final documents were already separate collections; they were
// only ever DRAWN as tabs. Turning them into rows is a rendering change, which
// is why the portal, the AI classifier, the filing engine and every RLS rule
// are untouched.
//
// The selected task is CLIENT state, not a URL. Everything all four panels
// render is already loaded, so a round trip per click would buy a linkable URL
// at the cost of the exact latency the founder complained about on the client
// page's tabs.

export function EngagementTabs({
  tasks,
  checklistCount,
  checklistDone,
  signaturesCount,
  signaturesDone,
  finalCount,
  checklistControls,
  signaturesControls,
  finalControls,
  checklist,
  signatures,
  final,
  work,
  addTask,
}: {
  /** Every task on this engagement, in order. Empty is the ordinary state of
   *  a new job and renders as such. */
  tasks: { id: string; title: string; kind: string }[];
  checklistCount: number;
  checklistDone: number;
  signaturesCount: number;
  signaturesDone: number;
  finalCount: number;
  checklistControls: ReactNode;
  signaturesControls: ReactNode;
  finalControls: ReactNode;
  checklist: ReactNode;
  signatures: ReactNode;
  final: ReactNode;
  /** The plain tasks, rendered as rows by the shared list. */
  work: ReactNode;
  /** The "+ Add task" control — Canopy's own label on this screen. */
  addTask: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState<string | null>(null);

  const openTask = tasks.find((x) => x.id === open) ?? null;

  if (openTask) {
    const panel =
      openTask.kind === "document_collection"
        ? { node: checklist, controls: checklistControls }
        : openTask.kind === "signatures"
          ? { node: signatures, controls: signaturesControls }
          : { node: final, controls: finalControls };
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5">
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="-ml-1 flex items-center gap-1 rounded-md px-1 py-2 text-base font-semibold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            {openTask.title}
          </button>
          <div className="flex items-center gap-2">{panel.controls}</div>
        </div>
        {panel.node}
      </section>
    );
  }

  // Progress for a kind that owns a collection. A plain task has none — its
  // status IS its progress.
  const meta = (kind: string) =>
    kind === "document_collection"
      ? t("task_progress", { done: checklistDone, total: checklistCount })
      : kind === "signatures"
        ? t("task_progress", { done: signaturesDone, total: signaturesCount })
        : kind === "deliverables"
          ? t("task_count", { count: finalCount })
          : "";

  const icon = (kind: string) =>
    kind === "document_collection" ? (
      <Inbox className="size-4" aria-hidden />
    ) : kind === "signatures" ? (
      <FileSignature className="size-4" aria-hidden />
    ) : (
      <FolderCheck className="size-4" aria-hidden />
    );

  const withScreens = tasks.filter((x) => x.kind !== "task");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
        <h2 className="px-1 py-2 text-base font-semibold tracking-tight text-foreground">
          {t("engagement_work")}
        </h2>
        <div className="flex items-center gap-2 pb-1.5">{addTask}</div>
      </div>

      {withScreens.length > 0 && (
        <ul className="divide-y divide-border/60">
          {withScreens.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => setOpen(task.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors",
                  "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {icon(task.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {task.title}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                    {meta(task.kind)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The plain tasks. Same list component the Work page uses, so the two
          screens cannot drift about what a task row looks like. */}
      {work}
    </section>
  );
}
