"use client";

// The Overview's task panel — THE TASKS TABLE, not a second one.
//
// The founder, twice, and the second time bluntly: "the overview page is fucked
// omg. it did not change in fact you made it worse."
//
// They were right on both counts. This card had its own row design, its own
// status handling, its own assignee picker and its own quick-add — a parallel
// implementation of the Tasks page that happened to look similar the day it
// was written. Then I added the firm's coloured status pill to it WITHOUT
// noticing its checkbox only ever wrote the bucket and never the status id, so
// a task ticked off here kept rendering "In progress" under a ticked box and a
// strikethrough. Three signals, one of them lying.
//
// A pill that contradicts the checkbox beside it is worse than no pill, and
// the reason it could happen at all is the reason this file is now thirty
// lines: two implementations of one thing will always drift, and patching the
// copy is how you get a third state nobody tested.
//
// So the card is a HEADER and the real table. Everything the rows do — the
// tick with its undo, the coloured statuses, the type link, the assignee menu,
// sorting, filtering — is the same code the Tasks page runs, because it IS the
// Tasks page's code.
//
// ── WHAT WAS LOST, DELIBERATELY ────────────────────────────────────────────
//
// The old card grouped rows by due date (Overdue / Today / Later / Done today).
// That framing has not disappeared: the stats strip directly above this card
// says 0 Overdue, 0 Due today, 0 Due this week, and each cell links to /work
// filtered the same way. The grouping was answering a question the row of
// numbers above it already answers, in a list that then disagreed with the
// Tasks page about what a task looks like.

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ChevronRight } from "lucide-react";
import {
  TasksTable,
  type TaskRow,
  type FirmStatus,
} from "@/components/engagements/tasks-table";
import {
  AddTaskDialog,
  type AddTaskEngagement,
} from "@/components/engagements/add-task-dialog";
import { type ComboboxClient } from "@/components/clients/client-combobox";

type Person = { id: string; name: string };

export function TasksOverviewCard({
  tasks,
  members,
  clients,
  engagements,
  statuses,
  viewerId,
}: {
  tasks: TaskRow[];
  members: Person[];
  clients: ComboboxClient[];
  /** For the add popover: a collection kind needs a job to hang off. */
  engagements: AddTaskEngagement[];
  statuses: FirmStatus[];
  viewerId: string;
}) {
  const t = useTranslations("Dashboard");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">
          {t("tasks_card_title")}
        </h2>
        <div className="flex items-center gap-3">
          <Link
            href="/work"
            className="flex items-center gap-0.5 text-sm text-accent transition-colors hover:underline"
          >
            {t("tasks_view_all")}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
          <AddTaskDialog
            clients={clients}
            engagements={engagements}
            members={members}
          />
        </div>
      </div>

      <TasksTable
        tasks={tasks}
        members={members}
        canEdit
        statuses={statuses}
        currentUserId={viewerId}
        variant="firm"
        // A PANEL on a page of panels, not the page itself. Uncapped it ran the
        // dashboard down past everything else on it; the founder: "make the
        // tasks box a little shorter... the same size it was last time."
        // Five is what the old card showed, and "+N more" goes to the full list.
        maxRows={5}
        moreHref="/work"
      />
    </div>
  );
}
