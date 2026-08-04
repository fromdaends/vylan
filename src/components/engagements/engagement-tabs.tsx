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
// So this opens on the LIST, and each of the three built-in tasks opens its own
// screen when clicked. Custom tasks live in the same list and need no screen —
// a title, an owner and a checkbox is the whole of them.
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
  checklistCount,
  checklistDone,
  signaturesCount,
  signaturesDone,
  finalCount,
  showSignatures,
  showFinal,
  checklistControls,
  signaturesControls,
  finalControls,
  checklist,
  signatures,
  final,
  work,
  workCount,
  workDone,
  showWork,
}: {
  checklistCount: number;
  /** Approved, so the row can say 8 of 12 rather than just 12. */
  checklistDone: number;
  signaturesCount: number;
  signaturesDone: number;
  finalCount: number;
  showSignatures: boolean;
  showFinal: boolean;
  checklistControls: ReactNode;
  signaturesControls: ReactNode;
  finalControls: ReactNode;
  checklist: ReactNode;
  signatures: ReactNode;
  final: ReactNode;
  /** The firm's own tasks — rendered INSIDE the list, not behind a row. */
  work: ReactNode;
  workCount: number;
  workDone: number;
  showWork: boolean;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState<"checklist" | "signatures" | "final" | null>(
    null,
  );

  // A task that stops applying while you are looking at it (signatures vanish
  // when a signature-free engagement is completed) must not leave a blank body.
  const showing =
    (open === "signatures" && !showSignatures) ||
    (open === "final" && !showFinal)
      ? null
      : open;

  if (showing) {
    const panel =
      showing === "checklist"
        ? { title: t("checklist"), node: checklist, controls: checklistControls }
        : showing === "signatures"
          ? { title: t("signatures"), node: signatures, controls: signaturesControls }
          : { title: t("final_documents"), node: final, controls: finalControls };
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5">
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="-ml-1 flex items-center gap-1 rounded-md px-1 py-2 text-base font-semibold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            {panel.title}
          </button>
          <div className="flex items-center gap-2">{panel.controls}</div>
        </div>
        {panel.node}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="border-b border-border px-1 py-2 text-base font-semibold tracking-tight text-foreground">
        {t("engagement_work")}
      </h2>

      <ul className="divide-y divide-border/60">
        <TaskRow
          icon={<Inbox className="size-4" aria-hidden />}
          label={t("checklist")}
          progress={t("task_progress", {
            done: checklistDone,
            total: checklistCount,
          })}
          onOpen={() => setOpen("checklist")}
        />
        {showSignatures && (
          <TaskRow
            icon={<FileSignature className="size-4" aria-hidden />}
            label={t("signatures")}
            progress={t("task_progress", {
              done: signaturesDone,
              total: signaturesCount,
            })}
            onOpen={() => setOpen("signatures")}
          />
        )}
        {showFinal && (
          <TaskRow
            icon={<FolderCheck className="size-4" aria-hidden />}
            label={t("final_documents")}
            progress={t("task_count", { count: finalCount })}
            onOpen={() => setOpen("final")}
          />
        )}
      </ul>

      {/* The firm's own tasks, in the same list rather than behind a row of
          their own. They have no screen to open — a title, an owner and a
          checkbox is the whole of them, so a row that led somewhere would lead
          to a page showing one line. */}
      {showWork && (
        <div className="pt-1">
          <p className="px-1 pb-1 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {t("work_tab")}{" "}
            {workCount > 0 && (
              <span className="tabular-nums opacity-70">
                {t("task_progress", { done: workDone, total: workCount })}
              </span>
            )}
          </p>
          {work}
        </div>
      )}
    </section>
  );
}

// One built-in task. A row that opens a screen, so it looks like a row that
// opens a screen — a chevron, and the whole thing is the target.
function TaskRow({
  icon,
  label,
  progress,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  progress: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
            {progress}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}
