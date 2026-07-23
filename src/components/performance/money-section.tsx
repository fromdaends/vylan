"use client";

import { useState, type ReactNode } from "react";
import { Clock, Lock, Timer, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatNumber, type AppLocale } from "@/lib/format";
import type {
  DocumentsSection as DocumentsData,
  MoneySection as MoneyData,
} from "@/lib/performance/types";
import type { PerfCopy } from "./copy";
import { CountUp } from "./count-up";
import { BarChart } from "./bar-chart";
import { SegmentedControl } from "./segmented-control";
import { centsToCurrency, formatDays } from "./format";

const BIG = "num-display block text-3xl font-semibold tracking-tight sm:text-4xl";

// Which dataset the over-time chart shows. The money stat tiles + top-clients
// list stay put; only the chart (and its title) switch — founder wanted one
// chart you flip between money collected and documents received.
type ChartMode = "money" | "documents";

export function MoneySection({
  data,
  documents,
  locale,
  copy,
}: {
  data: MoneyData;
  documents: DocumentsData;
  locale: AppLocale;
  copy: PerfCopy["money"];
}) {
  const [mode, setMode] = useState<ChartMode>("money");
  const hasCollected = data.collectedCount > 0;
  const hasDocs = documents.totalReceived > 0;
  const money = (n: number) => centsToCurrency(n, locale, 0);

  return (
    <section>
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {copy.heading}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.caption}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-0">
        <Tile icon={<Wallet className="size-4 text-icon-emerald" />} label={copy.collected}>
          <CountUp value={data.collectedCents} format={money} className={cn(BIG, "text-foreground")} />
          <p className="mt-1 text-xs text-muted-foreground">
            {hasCollected
              ? `${copy.collectedCaption} · ${copy.payments(data.collectedCount)}`
              : copy.noneCollected}
          </p>
        </Tile>

        <Tile icon={<Clock className="size-4 text-icon-amber" />} label={copy.outstanding}>
          <CountUp value={data.outstandingCents} format={money} className={cn(BIG, "text-foreground")} />
          <p className="mt-1 text-xs text-muted-foreground">
            {data.outstandingCount > 0 ? copy.outstandingCaption : copy.noneOutstanding}
          </p>
        </Tile>

        <Tile icon={<Timer className="size-4 text-icon-blue" />} label={copy.timeToPaid}>
          {data.timeToPaid.avgDays != null ? (
            <>
              <CountUp
                value={data.timeToPaid.avgDays}
                format={(n) => copy.days(formatDays(n, locale))}
                className={cn(BIG, "text-foreground")}
              />
              {data.timeToPaid.split ? (
                <div className="mt-2 space-y-1" title={copy.lockHint}>
                  <SplitRow
                    label={copy.lockOn}
                    value={copy.days(formatDays(data.timeToPaid.split.lockedAvgDays, locale))}
                    locked
                  />
                  <SplitRow
                    label={copy.lockOff}
                    value={copy.days(formatDays(data.timeToPaid.split.unlockedAvgDays, locale))}
                  />
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.timeToPaidCaption}
                </p>
              )}
            </>
          ) : (
            <>
              <span className={cn(BIG, "text-muted-foreground/40")}>—</span>
              <p className="mt-1 text-xs text-muted-foreground">{copy.noTimeToPaid}</p>
            </>
          )}
        </Tile>
      </div>

      {/* Over-time chart — flips between Money collected and Documents received. */}
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground">
            {mode === "money" ? copy.chartAria : copy.chartDocsTitle}
          </div>
          <SegmentedControl
            size="sm"
            ariaLabel={copy.chartToggleAria}
            value={mode}
            onChange={setMode}
            options={[
              { value: "money", label: copy.chartMoneyLabel },
              { value: "documents", label: copy.chartDocsLabel },
            ]}
          />
        </div>

        {mode === "money" ? (
          hasCollected ? (
            <BarChart
              points={data.buckets.map((b) => ({ start: b.start, value: b.cents }))}
              granularity={data.granularity}
              locale={locale}
              formatValue={(v) => centsToCurrency(v, locale, 2)}
              barClass="bg-success"
              barActiveClass="bg-success"
              dotClass="bg-success"
            />
          ) : (
            <ChartEmpty>{copy.noneCollected}</ChartEmpty>
          )
        ) : hasDocs ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground tabular-nums">
              {documents.granularity === "day"
                ? copy.docsThisMonth(documents.totalReceived)
                : `${copy.docsReceived(documents.totalReceived)} · ${copy.docsPerMonth(
                    formatNumber(Math.round(documents.perMonthAvg), locale),
                  )}`}
            </p>
            <BarChart
              points={documents.buckets.map((b) => ({ start: b.start, value: b.count }))}
              granularity={documents.granularity}
              locale={locale}
              formatValue={(v) => copy.docsCount(formatNumber(v, locale), v)}
              barClass="bg-icon-blue"
              barActiveClass="bg-icon-blue"
              dotClass="bg-icon-blue"
            />
          </>
        ) : (
          <ChartEmpty>{copy.docsNone}</ChartEmpty>
        )}
      </div>

      {data.topClients.length > 0 && (
        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="mb-3 text-xs font-medium text-muted-foreground">
            {copy.topClients}
          </div>
          <ol className="space-y-2.5">
            {data.topClients.map((c, i) => {
              const pct = Math.max(
                (c.cents / data.topClients[0].cents) * 100,
                2,
              );
              return (
                <li key={`${c.name}-${i}`} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="w-28 shrink-0 truncate text-sm text-foreground sm:w-52">
                    {c.name}
                  </span>
                  <div className="relative h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-success/70 transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                    {money(c.cents)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground sm:h-60">
      {children}
    </div>
  );
}

function Tile({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 sm:px-6 sm:first:pl-0 sm:last:pr-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-border/50">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function SplitRow({
  label,
  value,
  locked,
}: {
  label: string;
  value: string;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        {locked && <Lock className="size-3 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}
