// WORK — the firm's whole workload, in one place.
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

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listClients } from "@/lib/db/clients";
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { AddTaskDialog } from "@/components/engagements/add-task-dialog";
import { InternalWork } from "@/components/engagements/internal-work";
import { WorkFilters, type WorkScope } from "@/components/work/work-filters";

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string; open?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  const [tasks, members, clients] = await Promise.all([
    listFirmTasks(),
    listFirmUsers(),
    // For the "+ Add task" picker. The founder's own example is the reason
    // this page can create anything at all: "a way to create tasks that dont
    // live within an engagement but they would still be tied to a client" —
    // Mathieu gets a CRA notice, somebody has to phone about it, and that is
    // part of no tax return.
    listClients(),
  ]);

  // Filters are applied HERE rather than in the query, because the two of them
  // are cheap set operations over a list the page already has and running them
  // server-side would cost a round trip per click.
  const scope: WorkScope = sp.scope === "mine" ? "mine" : "all";
  const openOnly = sp.open !== "0";
  const shown = tasks
    .filter((t) => (scope === "mine" ? t.assigneeIds.includes(user.id) : true))
    .filter((t) => (openOnly ? t.status !== "done" : true));

  const t = await getTranslations("Engagements");

  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("work_title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("work_subtitle")}
          </p>
        </div>
        {/* The same dialog the job page uses, in its firm-wide mode — a client
            picker instead of a kind picker. Not a second copy: see the note at
            the top of add-task-dialog.tsx. */}
        <AddTaskDialog
          mode="firm"
          clients={clients.map((c) => ({
            id: c.id,
            display_name: c.display_name,
            type: c.type,
            email: c.email,
          }))}
        />
      </header>

      <WorkFilters
        scope={scope}
        openOnly={openOnly}
        counts={{
          all: tasks.filter((x) => x.status !== "done").length,
          mine: tasks.filter(
            (x) => x.status !== "done" && x.assigneeIds.includes(user.id),
          ).length,
        }}
      />

      <InternalWork
        variant="firm"
        tasks={shown}
        members={members
          .filter((m) => !m.deactivated_at)
          .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))}
        canEdit
      />
    </div>
  );
}
