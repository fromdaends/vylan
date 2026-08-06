// The Work dashboard — Canopy's, rebuilt on Vylan's own numbers.
//
// Founder, having read Canopy's dashboards article and watched their demo:
// "start with the dashboard for tasks + engagements combined that looks and
// replicates Canopys exactly."
//
// It lives at /work/dashboard because that is where Canopy puts it — their
// Work sidebar reads Tasks List / Engagements List / Resolution Cases / Tax
// Organizers / Dashboard, and ours now reads Task list / Engagement list /
// Dashboard.
//
// EVERY NUMBER IS COMPUTED IN lib/dashboard/work-metrics.ts, which is pure and
// tested. This file's whole job is to read the firm's rows once and hand them
// over. See that module's header for why the split matters.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { listEntriesForInsights } from "@/lib/db/time-entries";
import { hoursByMember, rangeStart } from "@/lib/insights/metrics";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { listEngagements } from "@/lib/db/engagements";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { listMyKpiAlerts } from "@/lib/db/kpi-alerts";
import { todayInTimeZone } from "@/lib/tasks/dates";
import { isEngagementStage } from "@/lib/engagements/stage";
import {
  WorkDashboard,
  type DashboardEngagement,
} from "@/components/dashboard/work-dashboard";

export default async function WorkDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const [firm, tasks, engagements, statuses, alerts, t, tStage] =
    await Promise.all([
    getCurrentFirm(),
    listFirmTasks(),
    listEngagements(),
    listTaskStatuses(),
    // [] before 1690 is applied — the bells just render unlit.
    listMyKpiAlerts(),
    getTranslations("Dashboard"),
    // ⚠️ "Stage", NOT "Engagements". The stage labels live in their own
    // namespace, and asking the wrong one is invisible to tsc, to eslint and
    // to the build — next-intl renders a miss as the literal key, so the first
    // version of this page printed "Engagements.stage_collecting" across four
    // charts and a donut legend. Founder: "it's the code seeping through."
    // stage.test.ts now walks every stage in both languages so a wrong
    // namespace fails a test instead of a screenshot.
    getTranslations("Stage"),
  ]);

  // "Today" in the FIRM's timezone, decided once and passed down — the server
  // renders in UTC, where a Quebec evening is already tomorrow and half the
  // overdue count would be wrong.
  const today = todayInTimeZone(firm?.timezone ?? "America/Toronto");

  // CAPACITY (1750): this year's hours by member, when time tracking is on.
  // HOURS ONLY — the same shared chart the Insights Team tab draws, fed by
  // the same aggregation, visible to the whole firm per the founder's shared-
  // capacity ruling. "This year" matches Insights' default range so the two
  // homes of one number cannot quietly disagree.
  let capacity: { name: string; minutes: number }[] | null = null;
  if (firm && isTimeInsightsEnabled(firm)) {
    const start = rangeStart("this_year", firm.timezone, new Date());
    const [entries, members] = await Promise.all([
      listEntriesForInsights(start ? start.toISOString() : null),
      listFirmUsers(),
    ]);
    const names = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));
    capacity = hoursByMember(
      entries.map((e) => ({
        id: e.id,
        userId: e.user_id,
        clientId: e.client_id,
        engagementId: e.engagement_id,
        startedAt: e.started_at,
        durationMinutes: e.duration_minutes,
      })),
    ).map((h) => ({ name: names.get(h.userId) ?? "—", minutes: h.minutes }));
  }

  const stageLabel = (stage: string | null): string =>
    stage && isEngagementStage(stage)
      ? tStage(`stage_${stage}` as "stage_collecting")
      : t("dash_stage_none");

  const engagementRows: DashboardEngagement[] = engagements.map((e) => ({
    id: e.id,
    stage: e.stage ?? null,
    stageLabel: stageLabel(e.stage ?? null),
    createdAt: e.created_at ?? null,
    completedAt: e.completed_at ?? null,
    dueDate: e.due_date ?? null,
  }));

  return (
    <div className="w-full space-y-4 px-6 pt-7 pb-18 lg:px-11">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("dash_title")}
        </h1>
      </header>

      <WorkDashboard
        tasks={tasks.map((task) => ({
          id: task.id,
          kind: task.kind,
          status: task.status,
          statusId: task.statusId,
          dueDate: task.dueDate,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
        }))}
        engagements={engagementRows}
        statuses={statuses}
        today={today}
        capacity={capacity}
        alerts={alerts.map((a) => ({
          id: a.id,
          name: a.name,
          surface: a.surface,
          metric: a.metric,
        }))}
      />
    </div>
  );
}
