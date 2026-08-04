"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { InternalWork, type WorkRow } from "@/components/engagements/internal-work";

// An engagement's TASKS, as one list.
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
// ── ONE LIST, NOT TWO ───────────────────────────────────────────────────────
//
// The first version of this drew the kinds-with-screens itself and handed the
// plain tasks to a second component underneath, in a dashed box with its own
// empty state and its own add field. The founder, immediately: "the task view
// for a specific engagement ... is too barebones and doesnt match with the
// actual tasks screen", and "remove the whole nothing planned on your side box
// on an assignment. It should come purely from the add task."
//
// Both are one bug. Splitting a list by kind is how one screen's work ends up
// in two boxes that then drift. So the rows are drawn by internal-work.tsx —
// the SAME component the firm-wide Tasks page uses — and this file is now only
// the header, the add button, and the swap into a task's own screen.
//
// ── NO DATA CHANGED FOR ANY OF THIS ────────────────────────────────────────
//
// Signatures and final documents were already separate collections; they were
// only ever DRAWN as tabs. The portal, the AI classifier, the filing engine and
// every RLS rule are untouched.
//
// The selected task is CLIENT state, not a URL. Everything all three panels
// render is already loaded, so a round trip per click would buy a linkable URL
// at the cost of the exact latency the founder complained about on the client
// page's tabs.

export function EngagementTabs({
  tasks,
  members,
  canEdit,
  checklistControls,
  signaturesControls,
  finalControls,
  checklist,
  signatures,
  final,
  addTask,
}: {
  /** Every task on this job, in order. Empty is the ordinary state of a new
   *  job and renders as such. */
  tasks: WorkRow[];
  members: { id: string; name: string }[];
  canEdit: boolean;
  checklistControls: ReactNode;
  signaturesControls: ReactNode;
  finalControls: ReactNode;
  checklist: ReactNode;
  signatures: ReactNode;
  final: ReactNode;
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

  return (
    <section className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
        <h2 className="px-1 py-2 text-base font-semibold tracking-tight text-foreground">
          {t("engagement_work")}
        </h2>
        <div className="flex items-center gap-2 pb-1.5">{addTask}</div>
      </div>

      <InternalWork
        tasks={tasks}
        members={members}
        canEdit={canEdit}
        variant="job"
        onOpen={setOpen}
      />
    </section>
  );
}
