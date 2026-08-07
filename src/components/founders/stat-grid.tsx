// The dense numbers grid under the four big KPI cards.
//
// NOT another copy of the dashboard's OverviewStatsStrip: that one is hard-wired
// to WorklistRow + the Dashboard translation namespace and every cell is a link
// into a firm-scoped list, none of which exists here. This is the quieter
// second tier — a label, a number, and an optional one-line gloss — for the
// fifteen-odd platform counts that matter but do not each deserve a 40px
// numeral. The four that DO use the shared KpiCard.

import { cn } from "@/lib/cn";

export type Stat = {
  key: string;
  label: string;
  value: string;
  /** Small grey line under the number — what it is counted over, usually. */
  hint?: string;
  /** Dims a stat that is structurally zero (a feature nobody has used yet), so
   *  the eye skips it instead of reading it as a problem. */
  muted?: boolean;
};

export function StatGrid({
  stats,
  columns = 4,
  className,
}: {
  stats: Stat[];
  columns?: 3 | 4 | 5;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        columns === 5 && "lg:grid-cols-5",
        className,
      )}
    >
      {stats.map((s) => (
        <div key={s.key} className="min-w-0 border-l border-border/40 pl-3">
          <dt className="truncate text-xs text-muted-foreground">{s.label}</dt>
          <dd
            className={cn(
              "mt-1 text-xl font-semibold leading-none tracking-tight tabular-nums",
              s.muted ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {s.value}
          </dd>
          {s.hint && (
            <dd className="mt-1 truncate text-[11px] leading-tight text-muted-foreground/80">
              {s.hint}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** A plain bordered box with a title — the founders console's own card shape.
 *  ChartCard is used for the two plots (it owns the plot-height decision); this
 *  is for everything that is a list rather than a chart. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A horizontal proportion bar. Used by the adoption list; kept here so the
 *  bar, its track and its number can only ever be styled in one place. */
export function ProportionBar({
  value,
  outOf,
  label,
}: {
  value: number;
  outOf: number;
  label: string;
}) {
  // A denominator of zero is "nothing to measure yet", not 0% — showing an
  // empty bar with "0 of 0" reads as a failure when it is simply too early.
  const pct = outOf > 0 ? Math.round((value / outOf) * 100) : null;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <span className="truncate text-sm">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {pct === null ? "—" : `${value}/${outOf} · ${pct}%`}
      </span>
      <div
        className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={pct === null ? label : `${label}: ${value} of ${outOf}`}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
