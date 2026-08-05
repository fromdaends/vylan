// The tasks recycle bin (1650) — 30 days, then the purge cron.
//
// Founder, asked whether tasks should match engagements' recycle bin: "yeah do
// #2". Bulk delete on the tasks list was immediate and permanent — tick twelve
// rows, hit Delete, gone — while engagements have had a 30-day window since
// 0139 ("This is accounting software — nothing is hard-deleted straight from
// the UI"). A task carries the same evidence of what a firm did and when.
//
// ⚠️ THE SAME TABLE, in deletedMode. A separate "deleted tasks" list would
// drift from the live one the first time a column changed, and this is the
// repo's cohesion rule doing exactly what it is for. The mode swaps the row
// actions — Restore and Delete forever instead of status and assignee — and
// nothing else.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { listActiveFirmUsers } from "@/lib/db/users";
import { listDeletedFirmTasks } from "@/lib/db/engagement-tasks";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { TasksTable } from "@/components/engagements/tasks-table";
import { BackLink } from "@/components/ui/back-link";

export default async function DeletedTasksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const [tasks, members, statuses, t] = await Promise.all([
    listDeletedFirmTasks(),
    listActiveFirmUsers(),
    listTaskStatuses(),
    getTranslations("Engagements"),
  ]);

  return (
    <div className="w-full space-y-4 px-6 pt-7 pb-18 lg:px-11">
      <div className="space-y-2">
        <BackLink href="/work" label={t("back_to_work")} />
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("deleted_tasks_title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("deleted_tasks_hint")}
          </p>
        </header>
      </div>

      {tasks.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {t("deleted_tasks_empty")}
        </p>
      ) : (
        <TasksTable
          deletedMode
          tasks={tasks.map((task) => ({
            ...task,
            subtasks: [],
          }))}
          members={members.map((m) => ({
            id: m.id,
            name: m.display_name ?? m.name ?? m.email,
          }))}
          statuses={statuses}
          canEdit
          currentUserId={user.id}
          variant="firm"
        />
      )}
    </div>
  );
}
