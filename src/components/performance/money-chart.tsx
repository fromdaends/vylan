"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import type {
  MoneyBucket,
  MoneyBucketGranularity,
} from "@/lib/performance/types";
import { bucketLabel, centsToCurrency } from "./format";

export type ChartView = "bars" | "line";

// The money-collected chart. Bars (comparison) and a line (trend) render in the
// same box and cross-fade when the view toggles, so switching is a smooth morph
// rather than a hard swap. Bars grow in from the baseline (transform, not
// height, so it stays on the compositor); the line draws itself. All motion is
// disabled under prefers-reduced-motion.
export function MoneyChart({
  buckets,
  granularity,
  view,
  locale,
}: {
  buckets: MoneyBucket[];
  granularity: MoneyBucketGranularity;
  view: ChartView;
  locale: AppLocale;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const n = buckets.length;
  const labelEvery = granularity === "day" && n > 12 ? Math.ceil(n / 6) : 1;

  // Line points + round dots positioned in percent so they never distort.
  const points = buckets.map((b, i) => ({
    xPct: n === 1 ? 50 : (i / (n - 1)) * 100,
    yPct: 100 - (b.cents / max) * 100,
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.xPct} ${p.yPct}`)
    .join(" ");

  return (
    <div className="w-full">
      <div
        className="relative h-44 w-full sm:h-52"
        onMouseLeave={() => setHover(null)}
      >
        {/* Bars */}
        <motion.div
          className="absolute inset-0 flex items-end gap-[3%]"
          animate={{ opacity: view === "bars" ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.3 }}
          style={{ pointerEvents: view === "bars" ? "auto" : "none" }}
          aria-hidden={view !== "bars"}
        >
          {buckets.map((b, i) => {
            const pct = (b.cents / max) * 100;
            const h = b.cents > 0 ? Math.max(pct, 2) : 0;
            return (
              <div
                key={b.start}
                className="flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
              >
                <motion.div
                  className={cn(
                    "w-full rounded-t-md transition-colors",
                    hover === i ? "bg-success" : "bg-success/80",
                  )}
                  style={{ height: `${h}%`, transformOrigin: "bottom" }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          duration: 0.5,
                          delay: Math.min(i * 0.03, 0.4),
                          ease: [0.2, 0.8, 0.2, 1],
                        }
                  }
                />
              </div>
            );
          })}
        </motion.div>

        {/* Line */}
        <motion.svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          animate={{ opacity: view === "line" ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.3 }}
          aria-hidden={view !== "line"}
          style={{ pointerEvents: "none" }}
        >
          <motion.path
            d={linePath}
            fill="none"
            stroke="var(--color-success)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
          />
        </motion.svg>
        {/* Round dots for the line, positioned in percent so they stay circular. */}
        {view === "line" &&
          points.map((p, i) => (
            <span
              key={buckets[i].start}
              className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success"
              style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
              aria-hidden
            />
          ))}

        {/* Hover tooltip */}
        {hover !== null && buckets[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 -translate-y-1 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-card"
            style={{ left: `${((hover + 0.5) / n) * 100}%` }}
          >
            <span className="font-medium text-popover-foreground">
              {bucketLabel(buckets[hover].start, granularity, locale)}
            </span>
            <span className="ml-1.5 tabular-nums text-muted-foreground">
              {centsToCurrency(buckets[hover].cents, locale, 2)}
            </span>
          </div>
        )}
      </div>

      {/* X-axis labels */}
      <div className="mt-2 flex gap-[3%]" aria-hidden>
        {buckets.map((b, i) => (
          <div
            key={b.start}
            className="flex-1 truncate text-center text-[10px] tabular-nums text-muted-foreground"
          >
            {i % labelEvery === 0 ? bucketLabel(b.start, granularity, locale) : ""}
          </div>
        ))}
      </div>

      {/* Accessible text alternative to the chart. */}
      <span className="sr-only">
        {buckets
          .map(
            (b) =>
              `${bucketLabel(b.start, granularity, locale)}: ${centsToCurrency(b.cents, locale, 2)}`,
          )
          .join(", ")}
      </span>
    </div>
  );
}
