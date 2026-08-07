"use client";

// The two plots on the founders Overview.
//
// COHESION: recharts, ChartCard and seriesColor are the app's existing chart
// system (insights/hours-by-member-chart is the reference). A founders console
// drawing its own SVG bars would be a second charting approach in one codebase
// — the exact drift the rule exists to stop — and it would not follow when the
// card padding or the accent colour changes.

import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { ChartCard, seriesColor } from "@/components/dashboard/dashboard-cards";
import type { DayBucket } from "@/lib/founders/types";

/** Group a daily series into weeks, oldest first. A year of daily bars is 365
 *  slivers nobody can read; a year of weekly bars is 52 and shows the trend
 *  the founder is actually looking for. The label is the week's FIRST day. */
export function toWeekly(days: DayBucket[]): DayBucket[] {
  const out: DayBucket[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({
      date: chunk[0].date,
      count: chunk.reduce((a, b) => a + b.count, 0),
    });
  }
  return out;
}

/** "2026-08-06" → "Aug 6". Assembled by hand rather than through one
 *  Intl.format call with both parts: a combined weekday+month format orders
 *  them by locale and produced "August Monday" once already. */
function shortDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(d);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(d);
  return `${month} ${day}`;
}

export function SignupsChart({ data, locale }: { data: DayBucket[]; locale: string }) {
  const t = useTranslations("Founders");
  const weekly = toWeekly(data).map((b) => ({ ...b, label: shortDate(b.date, locale) }));
  const total = weekly.reduce((a, b) => a + b.count, 0);

  return (
    <ChartCard
      title={t("chart_signups")}
      exploreLabel={t("explore")}
      menuLabel={t("card_menu")}
      // A chart with no bars reads as broken; a sentence saying why does not.
      empty={total === 0 ? t("chart_signups_empty") : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.35 }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(v) => [String(v), t("chart_signups_unit")]}
          />
          <Bar dataKey="count" fill={seriesColor(0)} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ActivityChart({
  data,
  locale,
  title,
}: {
  data: DayBucket[];
  locale: string;
  /** The firm detail page reuses this plot with its own heading. */
  title?: string;
}) {
  const t = useTranslations("Founders");
  const rows = data.map((b) => ({ ...b, label: shortDate(b.date, locale) }));
  const total = rows.reduce((a, b) => a + b.count, 0);

  return (
    <ChartCard
      title={title ?? t("chart_activity")}
      exploreLabel={t("explore")}
      menuLabel={t("card_menu")}
      empty={total === 0 ? t("chart_activity_empty") : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="foundersActivityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={0.35} />
              <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(v) => [String(v), t("chart_activity_unit")]}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={seriesColor(0)}
            strokeWidth={2}
            fill="url(#foundersActivityFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
