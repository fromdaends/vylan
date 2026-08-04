"use client";

import { useState, type ReactNode } from "react";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import {
  TasksTable,
  type TaskRow,
  type FirmStatus,
} from "@/components/engagements/tasks-table";

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

type Panel = "tasks" | "services" | "client";

export function EngagementTabs({
  servicesPanel,
  clientViewPanel,
  itemCount,
  tasks,
  members,
  canEdit,
  statuses,
  currentUserId,
  checklistControls,
  signaturesControls,
  finalControls,
  checklist,
  signatures,
  final,
  addTask,
  initialTaskId = null,
}: {
  /** Canopy's Services tab — rendered by the page, which owns the data. */
  servicesPanel: ReactNode;
  /** Canopy's Client View tab. */
  clientViewPanel: ReactNode;
  /** Shown on the Services tab, so its emptiness is visible before clicking. */
  itemCount: number;
  /** Every task on this job, in order. Empty is the ordinary state of a new
   *  job and renders as such. */
  tasks: TaskRow[];
  members: { id: string; name: string }[];
  canEdit: boolean;
  /** The firm's own task statuses (1420). */
  statuses: FirmStatus[];
  /** Drives the table's "Mine" view. */
  currentUserId: string;
  checklistControls: ReactNode;
  signaturesControls: ReactNode;
  finalControls: ReactNode;
  checklist: ReactNode;
  signatures: ReactNode;
  final: ReactNode;
  /** The "+ Add task" control — Canopy's own label on this screen. */
  addTask: ReactNode;
  /**
   * Open this task's screen straight away. Set from ?task= so the Task type
   * link on the firm-wide table lands ON the document collection rather than
   * on the job's task list with one more click to go.
   */
  initialTaskId?: string | null;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState<string | null>(initialTaskId);
  // Client state, like the task selection below it: everything all three
  // panels render is already loaded, so a URL round trip per click would buy a
  // linkable tab at the cost of the latency the founder complained about.
  const [panel, setPanel] = useState<Panel>("tasks");

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
    <section className="space-y-4">
      {/* ── CANOPY'S THREE TABS ─────────────────────────────────────────────
          Manage Tasks · Services · Client View, from the founder's
          screenshots. They are three ANSWERS to three different questions —
          what are we doing, what did they agree to pay, and what do they see —
          which is why they are tabs rather than three stacked sections: only
          one of them is ever the reason you opened the page.

          Same ViewTabs strip the Tasks and Engagements lists use, so a tab row
          looks like a tab row everywhere in the product. */}
      <ViewTabs
        activeKey={panel}
        onSelect={(key) => setPanel(key as Panel)}
        ariaLabel={t("engagement_panels_label")}
        tabs={[
          { key: "tasks", label: t("panel_tasks") },
          { key: "services", label: t("panel_services"), count: itemCount },
          { key: "client", label: t("panel_client_view") },
        ]}
      />

      {panel !== "tasks" ? (
        panel === "services" ? (
          servicesPanel
        ) : (
          clientViewPanel
        )
      ) : (
      <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {t("engagement_work")}
        </h2>
        {addTask}
      </div>
      {/* THE SAME TABLE the firm-wide Tasks page draws, minus the Client column
          — every row on a job has the same client, and a column with one value
          is decoration. The founder's complaint was exactly this: "the task view
          for a specific engagement ... doesnt match with the actual tasks
          screen." One component is the only durable answer to that. */}
      <TasksTable
        tasks={tasks}
        members={members}
        canEdit={canEdit}
        statuses={statuses}
        currentUserId={currentUserId}
        variant="job"
        onOpen={setOpen}
      />
      </>
      )}
    </section>
  );
}
