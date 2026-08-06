"use client";

// Insights · Team — workload visibility, not surveillance (spec rule): no
// performance scoring, no rankings language, no idle data. Three pieces:
// hours by member (the SHARED HoursByMemberChart — same component the Work
// dashboard's Capacity tab renders), hours by service, and average hours per
// completed engagement by service.

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, seriesColor } from "@/components/dashboard/dashboard-cards";
import { Panel } from "@/components/ui/panel";
import { formatMinutes } from "@/lib/time/duration";
import { HoursByMemberChart } from "@/components/insights/hours-by-member-chart";
import type { InsightsPayload } from "@/lib/insights/load";

export function TeamTab({ data }: { data: InsightsPayload }) {
  const t = useTranslations("Insights");

  const services = data.team.byService.map((s) => ({
    name: s.service ?? t("service_general"),
    hours: Math.round((s.minutes / 60) * 10) / 10,
    minutes: s.minutes,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t("chart_hours_by_member")}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
          empty={data.team.byMember.length === 0 ? t("empty_hours") : undefined}
        >
          <HoursByMemberChart
            data={data.team.byMember.map((m) => ({
              name: m.name,
              minutes: m.minutes,
            }))}
          />
        </ChartCard>

        <ChartCard
          title={t("chart_hours_by_service")}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
          empty={services.length === 0 ? t("empty_hours") : undefined}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={services}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(_v, _n, item) => [
                  formatMinutes((item?.payload as { minutes: number }).minutes),
                  "",
                ]}
              />
              <Bar dataKey="hours" fill={seriesColor(2)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Panel title={t("avg_hours_title")}>
        {data.team.avgByService.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("avg_hours_empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 font-medium">{t("avg_col_service")}</th>
                <th className="py-1.5 text-right font-medium">
                  {t("avg_col_count")}
                </th>
                <th className="py-1.5 text-right font-medium">
                  {t("avg_col_hours")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/45">
              {data.team.avgByService.map((row) => (
                <tr key={row.service ?? "__general__"}>
                  <td className="py-2">{row.service ?? t("service_general")}</td>
                  <td className="py-2 text-right tabular-nums">{row.count}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMinutes(row.avgMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
