// TASKS — the firm's whole workload, in one table.
//
// The gap the founder named: "the way ours works rn is dead". To see what
// needed doing you opened a client, then a job. There was no screen that
// answered "what does my firm have to do" — and a practice-management tool
// without one is a filing cabinet.
//
// This is that screen. It shows TASKS across every client: the ones attached
// to a job, and the ones attached only to a client ("call the CRA about the
// notice"), which 1350 made possible.
//
// Engagements stay their own list at /engagements, reached from the same Work
// menu in the rail. They are not merged: a job carries a client portal, six
// stages, AI classification, filing and payments, and folding that into a
// generic task would be a rewrite with a real chance of breaking the core of
// the product for no gain the founder asked for.
//
// The view tabs, the sorting and the filtering all live in the TABLE, client
// side. Everything is already on the page — the list is in the hundreds, not
// the millions — so a query per click would put a network round trip between
// the founder and a sort order.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listClients } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import {
  matchesDueFilter,
  toDueFilter,
  todayInTimeZone,
} from "@/lib/tasks/dates";
import { AddTaskDialog } from "@/components/engagements/add-task-dialog";
import { TasksTable } from "@/components/engagements/tasks-table";

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ due?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  const [tasks, members, clients, engagements, statuses] = await Promise.all([
    listFirmTasks(),
    listFirmUsers(),
    // For the "+ Add task" picker. The founder's own example is why this page
    // can create anything at all: "a way to create tasks that dont live within
    // an engagement but they would still be tied to a client" — Mathieu gets a
    // CRA notice, somebody has to phone about it, and that is part of no tax
    // return.
    listClients(),
    // And the jobs, so a DOCUMENT COLLECTION can be started from here too —
    // the merge the founder asked for. A collection kind needs a job to hang
    // off, so the dialog asks for one rather than hiding the option.
    listEngagements(),
    // The firm's own statuses. Request-cached, so the table, the create dialog
    // and anything else on this page share one read.
    listTaskStatuses(),
  ]);

  // The dashboard's stats strip links here as /work?due=overdue|today|week —
  // a cell saying 3 must land on a list of 3, decided by the SAME functions
  // that counted (lib/tasks/dates, anchored to the firm's today). The cut is
  // applied server-side to what the table receives; the table's own tabs,
  // sorting and filters then operate within it.
  const due = toDueFilter(sp.due);
  const today = todayInTimeZone(firm.timezone ?? "America/Toronto");

  // RESTORED after I deleted it by accident while moving the Add button: the
  // dashboard's stats strip links here as /work?due=overdue|today|week, and a
  // cell saying 3 must land on a list of 3. Applied to what the TABLE receives;
  // its own tabs, sorting and filters then operate within that cut.
  // No ?due= means no cut — the whole list, and the table's own tabs take over.
  const shown = due
    ? tasks.filter((task) => matchesDueFilter(task, due, today))
    : tasks;

  const t = await getTranslations("Engagements");
  const activeMembers = members
    .filter((m) => !m.deactivated_at)
    .map((m) => ({ id: m.id, name: userDisplayLabel(m) }));

  // Which built-in kinds each job already has, so the picker can grey out the
  // ones the database would refuse (1370) instead of erroring after the click.
  const kindsByEngagement = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.engagementId || task.kind === "task") continue;
    const list = kindsByEngagement.get(task.engagementId) ?? [];
    list.push(task.kind);
    kindsByEngagement.set(task.engagementId, list);
  }

  return (
    <div className="space-y-5">
      {/* Title only. The founder cut the subtitle — "Everything your firm has
          to do, across every client" was describing the page to somebody who is
          already looking at it. work_subtitle is left in the message files
          rather than deleted; removing a key is on the ask-first list. */}
      {/* The button sits level with the title, not tucked beside the tabs.
          Founder: "move up the button so its more centered" — and it is the one
          thing you come to this screen to DO, so it belongs in the header
          rather than in the row of view switches. */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("work_title")}
        </h1>
        <AddTaskDialog
          clients={clients.map((c) => ({
            id: c.id,
            display_name: c.display_name,
            type: c.type,
            email: c.email,
          }))}
          engagements={engagements.map((e) => ({
            id: e.id,
            clientId: e.client_id,
            title: e.title,
            existingKinds: kindsByEngagement.get(e.id) ?? [],
          }))}
          members={activeMembers}
        />
      </header>

      <TasksTable
        tasks={shown}
        members={activeMembers}
        canEdit
        statuses={statuses}
        currentUserId={user.id}
        variant="firm"
      />
    </div>
  );
}
