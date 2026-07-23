"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import type { MoneyBucketGranularity } from "@/lib/performance/types";
import { bucketLabel, bucketLabelFull } from "./format";

// Chart geometry in a 0..100 box. Bars + guide + tooltip are HTML positioned in
// percent so nothing distorts.
const PAD_X = 3;
const PAD_TOP = 14;
const PAD_BOT = 10;
const BASE_Y = 100 - PAD_BOT;

export type ChartPoint = { start: string; value: number };

// Generic one-bar-per-period chart. Hovering anywhere snaps a vertical guide to
// the nearest bar, highlights it, and shows a tidy tooltip (formatted value +
// period). Bars grow in from the baseline; motion is disabled under
// prefers-reduced-motion. Money and Documents both render through this so the
// two chart views are pixel-identical in everything but colour + value format.
export function BarChart({
  points,
  granularity,
  locale,
  formatValue,
  barClass = "bg-success",
  barActiveClass = "bg-success",
  dotClass = "bg-success",
}: {
  points: ChartPoint[];
  granularity: MoneyBucketGranularity;
  locale: AppLocale;
  // Exact value for the tooltip + the screen-reader alternative.
  formatValue: (value: number) => string;
  // Tailwind bg-* for the bars (money = green, documents = blue). barClass is
  // the resting fill; barActiveClass the hovered fill; dotClass the tooltip dot.
  barClass?: string;
  barActiveClass?: string;
  dotClass?: string;
}) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  const max = Math.max(1, ...points.map((b) => b.value));
  const xAt = (i: number) =>
    PAD_X + ((i + 0.5) / Math.max(1, n)) * (100 - 2 * PAD_X);
  const yAt = (value: number) =>
    PAD_TOP + (1 - value / max) * (BASE_Y - PAD_TOP);
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
        {points.map((b, i) => {
          const top = yAt(b.value);
          const active = hover === i;
          return (
            <motion.div
              key={b.start}
              className={cn(
                "absolute rounded-t-[3px] transition-colors",
                active ? barActiveClass : cn(barClass, "opacity-70"),
              )}
              style={{
                left: `${xAt(i)}%`,
                top: `${top}%`,
                height: `${Math.max(BASE_Y - top, b.value > 0 ? 0.8 : 0)}%`,
                width: `${barW}%`,
                transform: "translateX(-50%)",
                transformOrigin: "bottom",
              }}
              // initial is unconditional (not reduce-gated): the reduced-motion
              // hook is null on the server but real on the client's first render,
              // so gating initial on it would hydrate-mismatch the bar transform.
              // Reduced motion instead makes the transition instant (duration 0).
              initial={{ scaleY: 0 }}
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
        {hover != null && points[hover] && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-card"
            style={{
              left: `${Math.min(Math.max(xAt(hover), 12), 88)}%`,
              top: `${Math.max(yAt(points[hover].value) - 6, 2)}%`,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn("size-1.5 rounded-full", dotClass)}
                aria-hidden
              />
              <span className="text-sm font-semibold tabular-nums text-popover-foreground">
                {formatValue(points[hover].value)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {bucketLabelFull(points[hover].start, granularity, locale)}
            </div>
          </div>
        )}
      </div>

      {/* X-axis labels. */}
      <div className="mt-2 flex" aria-hidden>
        {points.map((b, i) => (
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
        {points
          .map(
            (b) =>
              `${bucketLabelFull(b.start, granularity, locale)}: ${formatValue(b.value)}`,
          )
          .join(", ")}
      </span>
    </div>
  );
}
