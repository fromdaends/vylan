"use client";

// Hours by team member — ONE chart, TWO homes.
//
// This renders in the Insights Team tab AND in the Work dashboard's Capacity
// tab, because they are the same concept: the founder's ruling made hours
// firm-readable ("maybe have a shared capacity view"), so the workload picture
// the owner reads in Insights is the same picture the team reads on the
// dashboard. One component is what keeps them from drifting — the cohesion
// rule's smallest useful unit.
//
// HOURS ONLY, structurally: the input type has no dollar field, so the
// firm-visible home cannot leak what the gated home knows.
//
// No individual performance framing: bars are sorted by size because a chart
// has to have an order, but there is no target line, no ranking language, no
// comparison callout. Workload visibility, not surveillance (spec rule).

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMinutes } from "@/lib/time/duration";
import { seriesColor } from "@/components/dashboard/dashboard-cards";

export type MemberHoursDatum = { name: string; minutes: number };

export function HoursByMemberChart({
  data,
  height = 260,
}: {
  data: MemberHoursDatum[];
  height?: number;
}) {
  const rows = data.map((d) => ({
    name: d.name,
    hours: Math.round((d.minutes / 60) * 10) / 10,
    minutes: d.minutes,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          labelStyle={{ color: "var(--foreground)" }}
        />
        <Bar dataKey="hours" fill={seriesColor(0)} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
