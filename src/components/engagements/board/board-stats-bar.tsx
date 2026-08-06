"use client";

// The four numbers across the top of the board.
//
// ── IT COUNTS UP, AND THEN IT STOPS DOING THAT ─────────────────────────────
//
// The handoff asks for 0 → value over 900ms on mount. Only on MOUNT: the
// numbers also change every time a card is dragged or a filter flips, and
// re-running a 900ms count-up on every drop would turn a subtraction of one
// hour into a slot machine. After the first run the values simply change.
//
// ── ⚠️ MONEY IS NOT ALWAYS THERE ───────────────────────────────────────────
//
// `budgetCents` and friends are null for anyone without `rates.manage` — the
// founder's ruling, and the rule the time-tracking work established: staff must
// never see a rate or a labour-cost number. When they are null the cell shows
// hours as its headline instead of as a suffix. Same four cells, same layout,
// one less number.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatHoursShort, type BoardStats } from "@/lib/engagements/board-stats";
import { formatCurrency, type AppLocale } from "@/lib/format";

export function BoardStatsBar({
  stats,
  locale,
  labels,
  animate,
}: {
  stats: BoardStats;
  locale: AppLocale;
  labels: {
    workItems: string;
    budget: string;
    actual: string;
    remaining: string;
    currency: string;
  };
  /** First load. False on re-render and under reduced motion. */
  animate: boolean;
}) {
  return (
    <div className="grid max-w-[940px] grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
      <Cell
        label={labels.workItems}
        value={<CountUp to={stats.workItems} animate={animate} />}
        accent
      />
      <MoneyCell
        label={labels.budget}
        cents={stats.budgetCents}
        minutes={stats.budgetMinutes}
        locale={locale}
        currency={labels.currency}
        animate={animate}
      />
      <MoneyCell
        label={labels.actual}
        cents={stats.actualCents}
        minutes={stats.actualMinutes}
        locale={locale}
        currency={labels.currency}
        animate={animate}
      />
      <MoneyCell
        label={labels.remaining}
        cents={stats.remainingCents}
        minutes={stats.remainingMinutes}
        locale={locale}
        currency={labels.currency}
        animate={animate}
        // An overrun is red here too, for the same reason it is on the card.
        danger={stats.remainingMinutes < 0}
      />
    </div>
  );
}

function Cell({
  label,
  value,
  suffix,
  accent,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "pl-3.5",
        // The first cell's rule is accent and thicker — it is the count the
        // other three are about.
        accent ? "border-l-2 border-accent/60" : "border-l border-border",
      )}
    >
      <p
        className={cn(
          "text-[22px] font-semibold tabular-nums leading-tight",
          danger && "text-destructive",
        )}
      >
        {value}
        {suffix && (
          <span className="ml-1.5 text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        )}
      </p>
      <p className="mt-[3px] text-[11.5px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function MoneyCell({
  label,
  cents,
  minutes,
  locale,
  currency,
  animate,
  danger,
}: {
  label: string;
  cents: number | null;
  minutes: number;
  locale: AppLocale;
  currency: string;
  animate: boolean;
  danger?: boolean;
}) {
  // No rates capability: hours ARE the number, not a footnote to one.
  if (cents == null) {
    return (
      <Cell
        label={label}
        value={<CountUp to={minutes} animate={animate} render={formatHoursShort} />}
        danger={danger}
      />
    );
  }
  return (
    <Cell
      label={label}
      value={
        <CountUp
          to={cents}
          animate={animate}
          render={(c) => formatCurrency(Math.round(c) / 100, locale)}
        />
      }
      suffix={`${currency} · ${formatHoursShort(minutes)}`}
      danger={danger}
    />
  );
}

/**
 * 0 → value over 900ms, ease-out cubic, once.
 *
 * requestAnimationFrame rather than a CSS transition because the thing being
 * animated is TEXT — there is no interpolatable property, only a number being
 * re-rendered. The frame loop is cancelled on unmount so a board that is
 * navigated away from mid-count does not keep setting state.
 */
function CountUp({
  to,
  animate,
  render = (n: number) => String(Math.round(n)),
}: {
  to: number;
  animate: boolean;
  render?: (n: number) => string;
}) {
  const [shown, setShown] = useState(animate ? 0 : to);
  // Whether the one-time count-up has already run. After it has, `to` changes
  // land immediately — a drop should move the number, not replay the intro.
  const done = useRef(!animate);

  useEffect(() => {
    if (done.current) {
      setShown(to);
      return;
    }
    done.current = true;
    // The count-up is JAVASCRIPT, so the stylesheet's reduced-motion rules
    // cannot reach it. Asked here instead, and answered by simply arriving at
    // the number.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const jump = requestAnimationFrame(() => setShown(to));
      return () => cancelAnimationFrame(jump);
    }
    const from = 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      // ease-out cubic: fast, then settling — the opposite of a progress bar.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);

  return <>{render(shown)}</>;
}
