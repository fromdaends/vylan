"use client";

// Insights · Overview — exactly the spec's elements and NOTHING more:
// four stat cards, revenue by month, revenue vs labor cost. The spec says
// "keep the tab to exactly these elements", so resist the urge to add a chart.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, KpiCard, seriesColor } from "@/components/dashboard/dashboard-cards";
import { Switch } from "@/components/ui/switch";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/time/duration";
import { EstimatedLabel } from "@/components/insights/estimated-label";
import type { InsightsPayload } from "@/lib/insights/load";

function monthLabel(month: string, locale: string): string {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

const centsToDollars = (c: number) => Math.round(c) / 100;

export function OverviewTab({ data }: { data: InsightsPayload }) {
  const t = useTranslations("Insights");
  const locale = useLocale() as AppLocale;
  // "After Vylan subscription" — OFF by default (spec). Subtracts the firm's
  // subscription per month at the FIRM level only; never allocated per client.
  const [afterSub, setAfterSub] = useState(false);

  const money = (cents: number) =>
    formatCurrency(cents / 100, locale, { fractionDigits: 0 });

  const months = data.months.map((m) => ({
    label: monthLabel(m.month, locale),
    revenue: centsToDollars(m.revenueCents),
    cost: centsToDollars(
      m.costCents + (afterSub ? data.subscriptionCentsPerMonth : 0),
    ),
  }));

  const tooltipStyle = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  } as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t("kpi_revenue")}
          value={money(data.totals.revenueCents)}
          description={t("kpi_revenue_hint")}
          exploreHref="/billing"
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
        />
        <KpiCard
          title={t("kpi_hours")}
          value={formatMinutes(data.totals.minutes)}
          description={t("kpi_hours_hint")}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
        />
        <KpiCard
          title={t("kpi_margin")}
          value={money(data.totals.marginCents)}
          description={t("kpi_margin_hint")}
          tone={data.totals.marginCents < 0 ? "danger" : "default"}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
        />
        <KpiCard
          title={t("kpi_avg_rev_hour")}
          value={
            data.totals.avgRevenuePerHourCents == null
              ? t("not_applicable")
              : money(data.totals.avgRevenuePerHourCents)
          }
          description={
            data.totals.avgRevenuePerHourCents == null
              ? t("kpi_avg_rev_hour_na_hint")
              : t("kpi_avg_rev_hour_hint")
          }
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
        />
      </div>

      {/* The margin KPI is estimated; say so once, visibly, above the charts. */}
      <div className="flex items-center justify-end">
        <EstimatedLabel />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t("chart_revenue_monthly")}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
          empty={!data.hasPayments ? t("empty_revenue") : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => money(v * 100)}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                contentStyle={tooltipStyle}
                formatter={(v) => [money(Number(v) * 100), t("series_revenue")]}
              />
              <Bar dataKey="revenue" fill={seriesColor(0)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("chart_revenue_vs_cost")}
          legend={[
            { label: t("series_revenue"), color: seriesColor(0) },
            { label: t("series_cost"), color: seriesColor(4) },
          ]}
          exploreLabel={t("explore")}
          menuLabel={t("card_menu")}
          empty={
            !data.hasPayments && !data.hasEntries ? t("empty_margin") : undefined
          }
        >
          {/* Flex column inside the card's fixed plot box: the toggle takes
              its row, the chart takes the rest — no hand-tuned pixel split to
              drift out of sync with ChartCard's height. */}
          <div className="flex h-full flex-col">
          <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              {t("after_subscription")}
            </span>
            <Switch
              checked={afterSub}
              onCheckedChange={setAfterSub}
              ariaLabel={t("after_subscription")}
            />
          </div>
          <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={months} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => money(v * 100)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [
                  money(Number(v) * 100),
                  name === "revenue" ? t("series_revenue") : t("series_cost"),
                ]}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke={seriesColor(0)}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cost"
                stroke={seriesColor(4)}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          </div>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
