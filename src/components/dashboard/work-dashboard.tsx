"use client";

// THE WORK DASHBOARD — Canopy's Task Dashboard, rebuilt on Vylan's data.
//
// Founder, after their article and demo: "start with the dashboard for tasks +
// engagements combined that looks and replicates Canopys exactly. Literally
// copy it exactly."
//
// So the layout is theirs, beat for beat: a title, a tab strip under it, a
// KPI watchlist of four big numbers, then a 2×2 grid of charts.
//
// ── WHAT IS THEIRS AND WHAT COULD NOT BE ──────────────────────────────────
//
// Copied: the four KPIs (Open / Overdue / Completed / Percentage complete),
// "Tasks Completed Monthly by Task Type" (stacked bars), "Tasks Completed
// Monthly Year over Year" (a line per year), "Tasks Created Monthly by Task
// Type", and "Open Task Count by Status" (the donut, drawn in the firm's OWN
// status colours rather than a chart palette — that is the one place Vylan can
// beat a generic BI tool, because it knows what "Needs review" looks like).
//
// NOT copied, and why:
//   * Canopy's third tab is CAPACITY — average budgeted vs logged hours,
//     workload in days and weeks. Vylan has no time tracking at all (phase 8,
//     deliberately last). A tab of empty axes teaches people the page is
//     padding. The founder asked for "tasks + engagements combined", so the
//     second tab is ENGAGEMENTS, which is data we have.
//   * Canopy's alert bell (threshold notifications on a KPI) is real and
//     worth having. It is a build of its own and is not stubbed here.
//   * Their "Explore" opens ThoughtSpot's query builder. We have none and will
//     not fake one; ours goes to the list the number counts.
//
// ── WHY THE FILTERS ARE NOT CHIPS YET ─────────────────────────────────────
//
// Canopy's chip row is the most visible thing on their page and it is also the
// thing their own docs admit is broken: "While you can add filters within
// Dashboards, you cannot save them for future reference." Vylan's lists have
// saved views. Rather than ship a second, worse filter language on one page,
// the tab strip carries the one cut that matters here (all / mine) and the
// charts stay honest about the whole firm. Chips can follow, wired to the same
// saved views the lists already use.

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ViewTabs } from "@/components/ui/view-tabs";
import { ChartCard, KpiCard, seriesColor } from "@/components/dashboard/dashboard-cards";
import { taskKindLabelKey } from "@/lib/tasks/kinds";
import {
  completedYearOverYear,
  kindsPresent,
  monthlyByKind,
  openByStatus,
  taskKpis,
  type MetricTask,
  type TaskBucket,
} from "@/lib/dashboard/work-metrics";

export type DashboardStatus = {
  id: string;
  name: string;
  color: string;
  bucket: TaskBucket;
};

/** An engagement, reduced to what this page counts. */
export type DashboardEngagement = {
  id: string;
  stage: string | null;
  stageLabel: string;
  createdAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
};

type Tab = "tasks" | "engagements";

// EVERY SERIES SETS isAnimationActive={false}. Recharts grows bars from zero
// on mount, so the first paint of this page is four empty plots — a dashboard
// whose numbers wobble on arrival reads as one that is still loading. It also
// made the page unverifiable: the first screenshot taken against production
// caught exactly that frame and looked like four broken charts.
//
// How far back the monthly charts reach. Twelve is roughly what Canopy's shows
// and it is also the span where "same month last year" is still on the page.
const MONTHS = 12;

export function WorkDashboard({
  tasks,
  engagements,
  statuses,
  today,
}: {
  tasks: MetricTask[];
  engagements: DashboardEngagement[];
  statuses: DashboardStatus[];
  /** Resolved in the FIRM's timezone by the page — never `new Date()` here. */
  today: string;
}) {
  const t = useTranslations("Dashboard");
  const tEng = useTranslations("Engagements");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("tasks");

  // Month labels in the reader's language: "Aug 2026" / "août 2026".
  const monthLabel = useMemo(() => {
    // ⚠️ timeZone: "UTC" IS LOAD-BEARING. Date.UTC(y, m-1, 1) is midnight UTC
    // on the 1st, which in Toronto is 7pm on the LAST DAY OF THE MONTH BEFORE
    // — and Intl formats in the reader's own zone unless told otherwise. The
    // first version shipped without it and the year-over-year axis read
    // "Dec Jan Feb ... Nov". The dates were right; only their names were a
    // month early, for everyone west of Greenwich.
    const fmt = new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return (ym: string) => {
      const [y, m] = ym.split("-").map(Number);
      return fmt.format(new Date(Date.UTC(y, m - 1, 1)));
    };
  }, [locale]);

  const monthOnly = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    return (i: number) => fmt.format(new Date(Date.UTC(2000, i - 1, 1)));
  }, [locale]);

  const kindLabel = (kind: string) => tEng(taskKindLabelKey(kind) as "kind_task");

  // ── TASKS ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => taskKpis(tasks, today), [tasks, today]);

  const completedMonthly = useMemo(
    () => monthlyByKind(tasks, (x) => x.completedAt, { months: MONTHS }),
    [tasks],
  );
  const createdMonthly = useMemo(
    () => monthlyByKind(tasks, (x) => x.createdAt, { months: MONTHS }),
    [tasks],
  );
  const yoy = useMemo(() => completedYearOverYear(tasks), [tasks]);
  const donut = useMemo(() => openByStatus(tasks, statuses), [tasks, statuses]);

  // ── ENGAGEMENTS ─────────────────────────────────────────────────────────
  // The SAME four cards over engagement data, which is what "tasks +
  // engagements combined" asks for — not a second, differently-shaped page.
  const engagementTasks: MetricTask[] = useMemo(
    () =>
      engagements.map((e) => ({
        id: e.id,
        // The "kind" axis for an engagement is its STAGE, so the stacked bars
        // split by where the work was rather than by a type it does not have.
        kind: e.stageLabel,
        status: (e.completedAt ? "done" : "doing") as TaskBucket,
        dueDate: e.dueDate,
        createdAt: e.createdAt,
        completedAt: e.completedAt,
      })),
    [engagements],
  );
  const engKpis = useMemo(
    () => taskKpis(engagementTasks, today),
    [engagementTasks, today],
  );
  const engCompleted = useMemo(
    () => monthlyByKind(engagementTasks, (x) => x.completedAt, { months: MONTHS }),
    [engagementTasks],
  );
  const engCreated = useMemo(
    () => monthlyByKind(engagementTasks, (x) => x.createdAt, { months: MONTHS }),
    [engagementTasks],
  );
  const engYoy = useMemo(
    () => completedYearOverYear(engagementTasks),
    [engagementTasks],
  );
  const engByStage = useMemo(() => {
    const open = engagements.filter((e) => !e.completedAt);
    const counts = new Map<string, number>();
    for (const e of open) counts.set(e.stageLabel, (counts.get(e.stageLabel) ?? 0) + 1);
    const total = open.length;
    return [...counts]
      .map(([name, count], i) => ({
        id: name,
        name,
        color: seriesColor(i),
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 10000) / 100,
      }))
      .sort((a, b) => b.count - a.count);
  }, [engagements]);

  const isTasks = tab === "tasks";
  const k = isTasks ? kpis : engKpis;
  const completed = isTasks ? completedMonthly : engCompleted;
  const created = isTasks ? createdMonthly : engCreated;
  const years = isTasks ? yoy : engYoy;
  const slices = isTasks ? donut : engByStage;
  const labelFor = isTasks ? kindLabel : (s: string) => s;
  const listHref = isTasks ? "/work" : "/engagements";

  // Recharts wants flat rows. Built here rather than in the metrics module so
  // the numbers stay chart-library-agnostic — swapping recharts must not mean
  // rewriting what a month means.
  const toBars = (points: typeof completed, keys: string[]) =>
    points.map((p) => ({
      month: monthLabel(p.month),
      ...Object.fromEntries(keys.map((key) => [key, p.counts[key] ?? 0])),
    }));

  const completedKeys = kindsPresent(completed);
  const createdKeys = kindsPresent(created);
  const yoyRows = years.points.map((p) => ({
    month: monthOnly(p.monthIndex),
    ...p.byYear,
  }));

  const explore = t("dash_explore");
  const menu = t("dash_card_menu");
  const axis = "var(--muted-foreground)";

  return (
    <div className="space-y-4">
      <ViewTabs
        activeKey={tab}
        onSelect={(key) => setTab(key as Tab)}
        tabs={[
          { key: "tasks", label: t("dash_tab_tasks"), count: tasks.length },
          {
            key: "engagements",
            label: t("dash_tab_engagements"),
            count: engagements.length,
          },
        ]}
      />

      {/* THE KPI WATCHLIST — Canopy's phrase for it, and their exact four. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={isTasks ? t("dash_kpi_open") : t("dash_kpi_open_eng")}
          value={k.open.toLocaleString(locale)}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
        />
        <KpiCard
          title={isTasks ? t("dash_kpi_overdue") : t("dash_kpi_overdue_eng")}
          value={k.overdue.toLocaleString(locale)}
          // The only number here that means something is wrong. Everything
          // else on the strip is neutral by design.
          tone={k.overdue > 0 ? "danger" : "default"}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
        />
        <KpiCard
          title={isTasks ? t("dash_kpi_completed") : t("dash_kpi_completed_eng")}
          value={k.completed.toLocaleString(locale)}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
        />
        <KpiCard
          title={t("dash_kpi_percent")}
          value={`${k.percentComplete.toLocaleString(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}%`}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title={isTasks ? t("dash_chart_completed") : t("dash_chart_completed_eng")}
          legend={completedKeys.map((key, i) => ({
            label: labelFor(key),
            color: seriesColor(i),
          }))}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
          empty={completed.length === 0 ? t("dash_empty_completed") : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={toBars(completed, completedKeys)}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={28}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={TOOLTIP}
                labelStyle={{ color: "var(--foreground)" }}
              />
              {completedKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={labelFor(key)}
                  // Stacked, like Canopy's — one bar per month, split by type.
                  stackId="a"
                  fill={seriesColor(i)}
                  maxBarSize={44}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("dash_chart_yoy")}
          legend={years.years.map((y, i) => ({ label: y, color: seriesColor(i) }))}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
          empty={years.years.length === 0 ? t("dash_empty_completed") : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={yoyRows}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={28}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <Tooltip contentStyle={TOOLTIP} labelStyle={{ color: "var(--foreground)" }} />
              {years.years.map((y, i) => (
                <Line
                  key={y}
                  type="linear"
                  dataKey={y}
                  stroke={seriesColor(i)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={isTasks ? t("dash_chart_created") : t("dash_chart_created_eng")}
          legend={createdKeys.map((key, i) => ({
            label: labelFor(key),
            color: seriesColor(i),
          }))}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
          empty={created.length === 0 ? t("dash_empty_created") : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={toBars(created, createdKeys)}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={28}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={TOOLTIP}
                labelStyle={{ color: "var(--foreground)" }}
              />
              {createdKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={labelFor(key)}
                  stackId="a"
                  fill={seriesColor(i)}
                  maxBarSize={44}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={isTasks ? t("dash_chart_by_status") : t("dash_chart_by_stage")}
          exploreHref={listHref}
          exploreLabel={explore}
          menuLabel={menu}
          empty={slices.length === 0 ? t("dash_empty_open") : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="count"
                nameKey="name"
                // A DONUT, not a pie: Canopy's is a donut, and the hole is
                // where the eye rests instead of trying to compare wedge
                // angles at the centre.
                innerRadius="52%"
                outerRadius="78%"
                paddingAngle={1}
                isAnimationActive={false}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {slices.map((s) => (
                  // The firm's OWN status colours. This is the one thing a
                  // generic BI tool cannot do — it has never seen "Needs
                  // review" and does not know it is purple here.
                  <Cell key={s.id} fill={s.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP} labelStyle={{ color: "var(--foreground)" }} />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
                iconSize={8}
                formatter={(value) => {
                  const s = slices.find((x) => x.name === value);
                  // Canopy labels each slice "Draft - 1 (1.45%)". Same shape.
                  return (
                    <span className="text-xs text-muted-foreground">
                      {value}
                      {s ? ` — ${s.count} (${s.percent}%)` : ""}
                    </span>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

// Recharts renders its tooltip as an inline-styled div, so the app's tokens
// have to be handed to it rather than inherited from a class.
const TOOLTIP = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
} as const;
