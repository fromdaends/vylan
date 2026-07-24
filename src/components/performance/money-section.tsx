"use client";

import { useState, type ReactNode } from "react";
import { Clock, FileText, Lock, Timer, Wallet } from "lucide-react";
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

// The overview section is a COMPLETE switch between Money and Documents: the
// heading, the three stat tiles, the over-time chart, and the top-clients
// ranking all flip together (founder: "a complete switch in-between money and
// documents"). The toggle lives in the section header and drives everything.
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
  const isDocs = mode === "documents";
  const hasCollected = data.collectedCount > 0;
  const hasDocs = documents.totalReceived > 0;
  const money = (n: number) => centsToCurrency(n, locale, 0);
  const num = (n: number) => formatNumber(Math.round(n), locale);

  return (
    <section>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {isDocs ? copy.docsHeading : copy.heading}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isDocs ? copy.docsCaption : copy.caption}
          </p>
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
      </header>

      {/* Everything below the toggle remounts on mode change (keyed by mode) so
          the count-up tiles animate cleanly from 0 to the new metric, instead of
          tweening the shared CountUp instances from the money value to the
          document value (which briefly renders one metric's number under the
          other's label). */}
      <div key={mode}>
      {/* Stat tiles — money set or document set. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-0">
        {isDocs ? (
          <>
            {/* Leads with the average received PER MONTH (the honest, range-
                comparable figure) rather than a raw "in this period" total. For
                a single-month window the two are identical, so we just say
                "received this month"; over a longer window we show the monthly
                average with the total as context. */}
            <Tile icon={<FileText className="size-4 text-icon-emerald" />} label={copy.docsReceivedLabel}>
              <CountUp value={documents.perMonthAvg} format={num} className={cn(BIG, "text-foreground")} />
              <p className="mt-1 text-xs text-muted-foreground">
                {documents.monthsCovered <= 1
                  ? copy.docsThisMonthCaption
                  : `${copy.docsPerMonthCaption} · ${copy.docsReceivedTotal(num(documents.totalReceived))}`}
              </p>
            </Tile>

            <Tile icon={<Clock className="size-4 text-icon-amber" />} label={copy.docsPendingLabel}>
              <CountUp value={documents.pendingReview} format={num} className={cn(BIG, "text-foreground")} />
              <p className="mt-1 text-xs text-muted-foreground">
                {documents.pendingReview > 0 ? copy.docsPendingCaption : copy.docsNonePending}
              </p>
            </Tile>

            <Tile icon={<Timer className="size-4 text-icon-blue" />} label={copy.docsTimeToReviewLabel}>
              {documents.timeToReview.avgDays != null ? (
                <>
                  <CountUp
                    value={documents.timeToReview.avgDays}
                    format={(n) => copy.days(formatDays(n, locale))}
                    className={cn(BIG, "text-foreground")}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.docsTimeToReviewCaption}
                  </p>
                </>
              ) : (
                <>
                  <span className={cn(BIG, "text-muted-foreground/40")}>—</span>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.docsNoTimeToReview}</p>
                </>
              )}
            </Tile>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Over-time chart. */}
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-3 text-xs font-medium text-muted-foreground">
          {isDocs ? copy.chartDocsTitle : copy.chartAria}
        </div>
        {isDocs ? (
          hasDocs ? (
            <BarChart
              points={documents.buckets.map((b) => ({ start: b.start, value: b.count }))}
              granularity={documents.granularity}
              locale={locale}
              formatValue={(v) => copy.docsCount(formatNumber(v, locale), v)}
              barClass="bg-icon-blue"
              barActiveClass="bg-icon-blue"
              dotClass="bg-icon-blue"
            />
          ) : (
            <ChartEmpty>{copy.docsNone}</ChartEmpty>
          )
        ) : hasCollected ? (
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
        )}
      </div>

      {/* Top clients — by money paid or by documents sent. */}
      {isDocs
        ? documents.topClients.length > 0 && (
            <TopClientsList
              heading={copy.docsTopClients}
              rows={documents.topClients.map((c) => ({
                name: c.name,
                weight: c.count,
                value: copy.docsCount(formatNumber(c.count, locale), c.count),
              }))}
              barClass="bg-icon-blue/70"
              moreLabel={copy.topClientsMore(documents.topClients.length)}
              lessLabel={copy.topClientsLess}
            />
          )
        : data.topClients.length > 0 && (
            <TopClientsList
              heading={copy.topClients}
              rows={data.topClients.map((c) => ({
                name: c.name,
                weight: c.cents,
                value: money(c.cents),
              }))}
              barClass="bg-success/70"
              moreLabel={copy.topClientsMore(data.topClients.length)}
              lessLabel={copy.topClientsLess}
            />
          )}
      </div>
    </section>
  );
}

// How many ranked clients show before the "view more" toggle reveals the rest.
const TOP_CLIENTS_COLLAPSED = 3;

// Shared ranked list (money by cents, documents by count). `weight` drives the
// proportion bar; `value` is the pre-formatted right-hand figure. Shows the top
// three by default; a toggle reveals the full ranking (up to TOP_CLIENTS_LIMIT).
function TopClientsList({
  heading,
  rows,
  barClass,
  moreLabel,
  lessLabel,
}: {
  heading: string;
  rows: { name: string; weight: number; value: string }[];
  barClass: string;
  moreLabel: string;
  lessLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const top = rows[0]?.weight || 1;
  const canExpand = rows.length > TOP_CLIENTS_COLLAPSED;
  const visible = expanded ? rows : rows.slice(0, TOP_CLIENTS_COLLAPSED);
  return (
    <div className="mt-6 border-t border-border/60 pt-5">
      <div className="mb-3 text-xs font-medium text-muted-foreground">{heading}</div>
      <ol className="space-y-2.5">
        {visible.map((r, i) => {
          const pct = Math.max((r.weight / top) * 100, 2);
          return (
            <li key={`${r.name}-${i}`} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="w-28 shrink-0 truncate text-sm text-foreground sm:w-52">
                {r.name}
              </span>
              <div className="relative h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
                    barClass,
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                {r.value}
              </span>
            </li>
          );
        })}
      </ol>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </div>
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
