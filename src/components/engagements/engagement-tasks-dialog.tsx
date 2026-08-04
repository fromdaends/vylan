"use client";

// One job's tasks, opened from its count on the engagements list.
//
// Founder: "canopy has the feature to allow you to click on the tasks like ex:
// 3/4 and it brings up a screen of all those tasks for that specific
// engagement."
//
// ── IT IS THE SAME TABLE, NOT A LOOKALIKE ──────────────────────────────────
//
// Canopy's version is a read-only list — task name, status, assignee, priority,
// and a Close button. This renders TasksTable at variant="job" instead, which
// is the identical component the Tasks page and the engagement page already
// draw. Three consequences, all of them the point:
//
//   • the status pills, priorities and due dates cannot disagree with the two
//     screens either side of it, which is the drift CLAUDE.md's cohesion rule
//     exists to stop and which this codebase has already hit three times;
//   • you can actually WORK in it — tick a task off, reassign it — rather than
//     read it and go somewhere else to act;
//   • a new task field appears here the day it appears anywhere.
//
// ── LOADED BY THE CLICK, NOT BY AN EFFECT ──────────────────────────────────
//
// Nothing is fetched until the count is pressed. The alternative — shipping
// every row's tasks with the list — is a hundred task sets, a roster and the
// firm's statuses, fetched to draw a number the list already has.
//
// The FETCH lives in the table's click handler and this component is given the
// result. That is not only to satisfy the React Compiler's set-state-in-effect
// rule: an effect that fires on `open` has to re-derive which job it is for and
// guard against the previous job's response landing second, while a click
// already knows exactly which row it was.
//
// A failed load says so and offers the engagement itself; it does not show an
// empty table, because "no tasks" and "we could not ask" look identical and
// only one of them is worth acting on.

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TasksTable,
  type FirmStatus,
  type TaskRow,
} from "@/components/engagements/tasks-table";
export type EngagementTasksPanelData = {
  tasks: TaskRow[];
  members: { id: string; name: string }[];
  statuses: FirmStatus[];
  currentUserId: string;
};

export function EngagementTasksDialog({
  engagementId,
  engagementTitle,
  clientName,
  data,
  failed,
  open,
  onOpenChange,
}: {
  engagementId: string | null;
  engagementTitle: string;
  clientName?: string | null;
  /** null while the click's fetch is still in flight. */
  data: EngagementTasksPanelData | null;
  failed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Engagements");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w — NOT max-w. DialogContent's own base class carries
          `sm:max-w-lg`, and tailwind-merge treats a breakpoint variant and a
          plain utility as different properties, so a bare `max-w-4xl` loses at
          every width above `sm`. The panel rendered at ~440px and clipped the
          table. */}
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{engagementTitle}</DialogTitle>
          {/* The client, because the list you clicked from shows both and a
              panel that drops one of them makes you check which job this is. */}
          <DialogDescription>
            {clientName ? clientName : t("engagement_work")}
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>{t("tasks_panel_failed")}</p>
            {engagementId && (
              <Link
                href={`/engagements/${engagementId}`}
                className="mt-2 inline-block text-accent hover:underline"
              >
                {t("tasks_panel_open_engagement")}
              </Link>
            )}
          </div>
        ) : data ? (
          <TasksTable
            // ⚠️ ALL WORK, not the table's usual "Active work". You clicked a
            // TOTAL — "2/2" — so opening on a view that hides finished tasks
            // answers a question you did not ask, and on a fully-done job it
            // said "Nothing planned on your side yet" under a count of two.
            initialView="all"
            tasks={data.tasks}
            members={data.members}
            canEdit
            statuses={data.statuses}
            currentUserId={data.currentUserId}
            // Every row here is the same client's — a Client column with one
            // value repeated down it is decoration.
            variant="job"
          />
        ) : (
          // Rows rather than a spinner: the panel keeps the shape it is about
          // to have, so it settles instead of jumping.
          <div className="space-y-2 py-2" aria-busy>
            <span className="sr-only">{t("tasks_panel_loading")}</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
