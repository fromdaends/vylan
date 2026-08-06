"use client";

// Insights · Clients — the quadrant scatter (the centerpiece), three ranked
// tables, and the clients-in-the-red list.
//
// Quadrant guide lines sit at the MEDIAN of each axis, so the four corners
// always split the firm's actual book rather than some invented threshold.
// Clicking a dot goes to the client. Clients with revenue but zero logged
// hours are EXCLUDED from the scatter (a dot pinned to the axis is noise) and
// appear in the tables with a "no hours logged" marker instead.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useRouter } from "@/i18n/navigation";
import { ChartCard, seriesColor } from "@/components/dashboard/dashboard-cards";
import { Panel } from "@/components/ui/panel";
import { StatusCapsule } from "@/components/ui/status-capsule";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/time/duration";
import { EstimatedLabel } from "@/components/insights/estimated-label";
import type { ClientRow, InsightsPayload } from "@/lib/insights/load";

const centsToDollars = (c: number) => Math.round(c) / 100;

export function ClientsTab({ data }: { data: InsightsPayload }) {
  const t = useTranslations("Insights");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const money = (cents: number) =>
    formatCurrency(cents / 100, locale, { fractionDigits: 0 });

  const points = data.quadrant.points.map((p) => ({
    ...p,
    revenue: centsToDollars(p.revenueCents),
  }));

  return (
    <div className="space-y-4">
      <ChartCard
        title={t("chart_quadrant")}
        exploreLabel={t("explore")}
        menuLabel={t("card_menu")}
        empty={points.length === 0 ? t("empty_quadrant") : undefined}
        plotHeight="tall"
      >
        {/* Corner labels — quiet, muted, informational. "Costing you money"
            is bottom-right: high effort, low value. */}
        {/* h-full so the plot fills exactly the card's plot box (plotHeight
            above) — a taller child inside the fixed wrapper silently clips. */}
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="hours"
                name={t("axis_hours")}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                label={{
                  value: t("axis_hours"),
                  position: "insideBottom",
                  offset: -4,
                  fontSize: 11,
                  fill: "var(--muted-foreground)",
                }}
              />
              <YAxis
                type="number"
                dataKey="revenue"
                name={t("axis_revenue")}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => money(v * 100)}
              />
              <ReferenceLine
                x={data.quadrant.medianHours}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <ReferenceLine
                y={centsToDollars(data.quadrant.medianRevenueCents)}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as
                    | (typeof points)[number]
                    | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
                      <p className="font-medium text-foreground">{p.name}</p>
                      <p className="text-muted-foreground">
                        {t("tooltip_hours", { hours: String(p.hours) })}
                      </p>
                      <p className="text-muted-foreground">
                        {t("tooltip_revenue", { amount: money(p.revenueCents) })}
                      </p>
                      <p className="text-muted-foreground">
                        {t("tooltip_margin", { amount: money(p.marginCents) })}{" "}
                        <span className="uppercase">({t("estimated")})</span>
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter
                data={points}
                fill={seriesColor(0)}
                cursor="pointer"
                onClick={(p) => {
                  // Recharts hands the clicked NODE's props; the datum sits in
                  // .payload on some versions and is spread onto the props on
                  // others. Read both rather than trusting one shape, and go
                  // nowhere on a miss — a wrong-guess navigation to
                  // /clients/undefined would 404 the owner mid-analysis.
                  const node = p as unknown as {
                    clientId?: string;
                    payload?: { clientId?: string };
                  };
                  const clientId = node.payload?.clientId ?? node.clientId;
                  if (clientId) router.push(`/clients/${clientId}`);
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
          {points.length > 0 && (
            <>
              <span className="pointer-events-none absolute left-16 top-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {t("corner_high_value_low_effort")}
              </span>
              <span className="pointer-events-none absolute right-4 top-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {t("corner_high_value_high_effort")}
              </span>
              <span className="pointer-events-none absolute bottom-10 left-16 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {t("corner_low_value_low_effort")}
              </span>
              <span className="pointer-events-none absolute bottom-10 right-4 text-[10px] uppercase tracking-wide text-destructive/70">
                {t("corner_costing_you_money")}
              </span>
            </>
          )}
        </div>
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <RankedTable
          title={t("table_most_hours")}
          rows={data.mostHours}
          metric={(r) => formatMinutes(r.minutes)}
          locale={locale}
        />
        <RankedTable
          title={t("table_highest_revenue")}
          rows={data.highestRevenue}
          metric={(r) => money(r.revenueCents)}
          locale={locale}
        />
        <RankedTable
          title={t("table_lowest_margin")}
          rows={data.lowestMargin}
          metric={(r) => money(r.marginCents)}
          estimated
          locale={locale}
        />
      </div>

      <Panel
        title={t("in_red_title")}
        aside={<EstimatedLabel />}
      >
        {data.inRed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("in_red_none")}
          </p>
        ) : (
          <ul className="divide-y divide-border/45">
            {data.inRed.map((r) => (
              <ClientLine
                key={r.clientId}
                row={r}
                metric={money(r.marginCents)}
                metricClass="text-destructive"
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ClientLine({
  row,
  metric,
  metricClass = "",
}: {
  row: ClientRow;
  metric: string;
  metricClass?: string;
}) {
  const t = useTranslations("Insights");
  const router = useRouter();
  return (
    <li>
      <button
        type="button"
        onClick={() => router.push(`/clients/${row.clientId}`)}
        className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
        {row.zeroHours && (
          <StatusCapsule tone="muted">{t("no_hours_marker")}</StatusCapsule>
        )}
        <span
          className={`shrink-0 text-sm font-medium tabular-nums ${metricClass}`}
        >
          {metric}
        </span>
      </button>
    </li>
  );
}

function RankedTable({
  title,
  rows,
  metric,
  estimated = false,
}: {
  title: string;
  rows: ClientRow[];
  metric: (r: ClientRow) => string;
  estimated?: boolean;
  locale: AppLocale;
}) {
  const t = useTranslations("Insights");
  const [expanded, setExpanded] = useState(false);
  // Top 10, expandable (spec). Sort order IS the ranking; a flip control adds
  // a second answer to a list whose title already states its order.
  const shown = expanded ? rows : rows.slice(0, 10);
  return (
    <Panel title={title} aside={estimated ? <EstimatedLabel /> : undefined}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("table_empty")}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/45">
            {shown.map((r) => (
              <ClientLine key={r.clientId} row={r} metric={metric(r)} />
            ))}
          </ul>
          {rows.length > 10 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {expanded
                ? t("table_show_less")
                : t("table_show_all", { count: rows.length })}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}
