"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import type {
  MoneyBucket,
  MoneyBucketGranularity,
} from "@/lib/performance/types";
import { bucketLabel, bucketLabelFull, centsToCurrency } from "./format";

// Chart geometry in a 0..100 box. Bars + guide + tooltip are HTML positioned in
// percent so nothing distorts.
const PAD_X = 3;
const PAD_TOP = 14;
const PAD_BOT = 10;
const BASE_Y = 100 - PAD_BOT;

// Money-collected bar chart. One bar per period. Hovering anywhere snaps a
// vertical guide to the nearest bar, highlights it, and shows a tidy tooltip
// (exact amount + period). Bars grow in from the baseline; motion is disabled
// under prefers-reduced-motion.
export function MoneyChart({
  buckets,
  granularity,
  locale,
}: {
  buckets: MoneyBucket[];
  granularity: MoneyBucketGranularity;
  locale: AppLocale;
}) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const xAt = (i: number) =>
    PAD_X + ((i + 0.5) / Math.max(1, n)) * (100 - 2 * PAD_X);
  const yAt = (cents: number) =>
    PAD_TOP + (1 - cents / max) * (BASE_Y - PAD_TOP);
  const barW = Math.min(((100 - 2 * PAD_X) / Math.max(1, n)) * 0.6, 8);

  const labelEvery = granularity === "day" && n > 12 ? Math.ceil(n / 6) : 1;

  const onMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    const i = Math.min(n - 1, Math.max(0, Math.floor(f * n)));
    setHover(i);
  };

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="relative h-52 w-full cursor-crosshair sm:h-60"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Bars. */}
        {buckets.map((b, i) => {
          const top = yAt(b.cents);
          const active = hover === i;
          return (
            <motion.div
              key={b.start}
              className={cn(
                "absolute rounded-t-[3px] transition-colors",
                active ? "bg-success" : "bg-success/70",
              )}
              style={{
                left: `${xAt(i)}%`,
                top: `${top}%`,
                height: `${Math.max(BASE_Y - top, b.cents > 0 ? 0.8 : 0)}%`,
                width: `${barW}%`,
                transform: "translateX(-50%)",
                transformOrigin: "bottom",
              }}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      duration: 0.5,
                      delay: Math.min(i * 0.03, 0.35),
                      ease: [0.2, 0.8, 0.2, 1],
                    }
              }
            />
          );
        })}

        {/* Hover guide. */}
        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/15"
            style={{ left: `${xAt(hover)}%` }}
          />
        )}

        {/* Tooltip. */}
        {hover != null && buckets[hover] && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-card"
            style={{
              left: `${Math.min(Math.max(xAt(hover), 12), 88)}%`,
              top: `${Math.max(yAt(buckets[hover].cents) - 6, 2)}%`,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              <span className="text-sm font-semibold tabular-nums text-popover-foreground">
                {centsToCurrency(buckets[hover].cents, locale, 2)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {bucketLabelFull(buckets[hover].start, granularity, locale)}
            </div>
          </div>
        )}
      </div>

      {/* X-axis labels. */}
      <div className="mt-2 flex" aria-hidden>
        {buckets.map((b, i) => (
          <div
            key={b.start}
            className="flex-1 truncate text-center text-[10px] tabular-nums text-muted-foreground"
          >
            {i % labelEvery === 0 ? bucketLabel(b.start, granularity, locale) : ""}
          </div>
        ))}
      </div>

      {/* Accessible text alternative. */}
      <span className="sr-only">
        {buckets
          .map(
            (b) =>
              `${bucketLabelFull(b.start, granularity, locale)}: ${centsToCurrency(b.cents, locale, 2)}`,
          )
          .join(", ")}
      </span>
    </div>
  );
}
