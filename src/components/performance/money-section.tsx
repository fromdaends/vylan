"use client";

import { useState, type ReactNode } from "react";
import { Clock, Lock, Timer, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import {
  TOP_CLIENTS_COLLAPSED,
  type MoneySection as MoneyData,
} from "@/lib/performance/types";
import type { PerfCopy } from "./copy";
import { CountUp } from "./count-up";
import { MoneyChart } from "./money-chart";
import { centsToCurrency, formatDays } from "./format";

const BIG = "num-display block text-3xl font-semibold tracking-tight sm:text-4xl";

export function MoneySection({
  data,
  locale,
  copy,
}: {
  data: MoneyData;
  locale: AppLocale;
  copy: PerfCopy["money"];
}) {
  const hasCollected = data.collectedCount > 0;
  const money = (n: number) => centsToCurrency(n, locale, 0);
  const [showAllClients, setShowAllClients] = useState(false);
  const visibleClients = showAllClients
    ? data.topClients
    : data.topClients.slice(0, TOP_CLIENTS_COLLAPSED);

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

      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-3 text-xs font-medium text-muted-foreground">
          {copy.chartAria}
        </div>
        {hasCollected ? (
          <MoneyChart
            buckets={data.buckets}
            granularity={data.granularity}
            locale={locale}
          />
        ) : (
          <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground sm:h-60">
            {copy.noneCollected}
          </div>
        )}
      </div>

      {data.topClients.length > 0 && (
        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="mb-3 text-xs font-medium text-muted-foreground">
            {copy.topClients}
          </div>
          <ol className="space-y-2.5">
            {visibleClients.map((c, i) => {
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
          {data.topClients.length > TOP_CLIENTS_COLLAPSED && (
            <button
              type="button"
              onClick={() => setShowAllClients((v) => !v)}
              className="mt-3 cursor-pointer rounded-sm text-xs font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAllClients ? copy.viewLess : copy.viewMore}
            </button>
          )}
        </div>
      )}
    </section>
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
