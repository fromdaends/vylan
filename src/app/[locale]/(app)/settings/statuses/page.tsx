// The firm's task statuses.
//
// Its own page rather than a card on the settings index: it is a list you edit
// row by row, and a list has no honest resting size on a page of switches.
//
// READ by the whole firm, EDITED by the owner. Deliberately not a notFound()
// for staff, unlike the audit log: a status list is not private — every task
// row on every screen renders one — so hiding the page would only mean nobody
// but the owner could find out what "With client" is supposed to mean.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { TaskStatusesEditor } from "@/components/settings/task-statuses-editor";

export default async function TaskStatusesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  const [statuses, t] = await Promise.all([
    listTaskStatuses(),
    getTranslations("Settings"),
  ]);

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("statuses_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("statuses_subtitle")}
        </p>
      </header>

      <TaskStatusesEditor
        statuses={statuses}
        // Same gate the write actions use, so the UI cannot offer a control the
        // server will refuse.
        canEdit={can(user, "team.manage")}
      />
    </div>
  );
}
