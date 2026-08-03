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
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { InternalWork } from "@/components/engagements/internal-work";
import { WorkTabs } from "@/components/work/work-tabs";
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

  const [tasks, members] = await Promise.all([listFirmTasks(), listFirmUsers()]);

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("work_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("work_subtitle")}
        </p>
      </header>

      <WorkTabs current="tasks" />

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
