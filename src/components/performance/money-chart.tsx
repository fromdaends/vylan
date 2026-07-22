"use client";

import { useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import type {
  MoneyBucket,
  MoneyBucketGranularity,
} from "@/lib/performance/types";
import { bucketLabel, bucketLabelFull, centsToCurrency } from "./format";

export type ChartView = "bars" | "line";

// Chart geometry in a 0..100 box (the SVG uses viewBox 0 0 100 100 with
// preserveAspectRatio="none"; the line keeps a uniform width via a
// non-scaling stroke, and dots / guide / tooltip are HTML positioned in
// percent so they never distort).
const PAD_X = 3;
const PAD_TOP = 14;
const PAD_BOT = 10;
const BASE_Y = 100 - PAD_BOT;

// Money-collected chart. A smooth area (trend) and clean bars share one
// coordinate system and cross-fade when the view toggles. Hovering anywhere
// snaps a vertical guide to the nearest point and shows a tidy tooltip — the
// Vercel-style read. All motion is disabled under prefers-reduced-motion.
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
  const gradId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const xAt = (i: number) =>
    PAD_X + ((i + 0.5) / Math.max(1, n)) * (100 - 2 * PAD_X);
  const yAt = (cents: number) =>
    PAD_TOP + (1 - cents / max) * (BASE_Y - PAD_TOP);

  const points = buckets.map((b, i) => ({
    x: xAt(i),
    y: yAt(b.cents),
    cents: b.cents,
  }));
  const linePath = monotonePath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${BASE_Y} L ${points[0].x} ${BASE_Y} Z`
      : "";

  const gridYs = [0, 1, 2, 3].map((k) => PAD_TOP + (k / 3) * (BASE_Y - PAD_TOP));
  const labelEvery = granularity === "day" && n > 12 ? Math.ceil(n / 6) : 1;

  const onMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    const i = Math.min(n - 1, Math.max(0, Math.floor(f * n)));
    setHover(i);
  };

  const hovered = hover != null ? points[hover] : null;

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="relative h-52 w-full cursor-crosshair sm:h-60"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Faint gridlines + a slightly firmer baseline. */}
        {gridYs.map((gy, i) => (
          <div
            key={gy}
            className={cn(
              "pointer-events-none absolute inset-x-0 border-t",
              i === gridYs.length - 1 ? "border-border/60" : "border-border/25",
            )}
            style={{ top: `${gy}%` }}
          />
        ))}

        {/* Area + line (trend view). */}
        <motion.svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          animate={{ opacity: view === "line" ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.3 }}
          aria-hidden
          style={{ pointerEvents: "none" }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />}
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
            transition={reduce ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          />
        </motion.svg>

        {/* Bars view. */}
        <motion.div
          className="absolute inset-0"
          animate={{ opacity: view === "bars" ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.3 }}
          style={{ pointerEvents: "none" }}
          aria-hidden
        >
          {buckets.map((b, i) => {
            const top = yAt(b.cents);
            const barW = ((100 - 2 * PAD_X) / n) * 0.55;
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
        </motion.div>

        {/* Hover crosshair: guide line + point dot. */}
        {hovered && (
          <>
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/20"
              style={{ left: `${hovered.x}%` }}
            />
            {view === "line" && (
              <span
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-success bg-background"
                style={{ left: `${hovered.x}%`, top: `${hovered.y}%` }}
              />
            )}
          </>
        )}

        {/* Tooltip. */}
        {hovered && hover != null && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-card"
            style={{
              left: `${Math.min(Math.max(hovered.x, 12), 88)}%`,
              top: `${Math.max(hovered.y - 6, 2)}%`,
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

// Monotone cubic (Fritsch–Carlson) through the points → a smooth SVG path that
// never overshoots below the data (money is never negative, so no dips under the
// baseline). Falls back to a line for 0–2 points.
function monotonePath(pts: { x: number; y: number }[]): string {
  const nPts = pts.length;
  if (nPts === 0) return "";
  if (nPts === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (nPts === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < nPts - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }

  const tan: number[] = new Array(nPts);
  tan[0] = slope[0];
  tan[nPts - 1] = slope[nPts - 2];
  for (let i = 1; i < nPts - 1; i++) {
    tan[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  // Enforce monotonicity so the curve can't bulge past the data.
  for (let i = 0; i < nPts - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const s = 3 / h;
      tan[i] = s * a * slope[i];
      tan[i + 1] = s * b * slope[i];
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < nPts - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3;
    const y1 = pts[i].y + (tan[i] * dx[i]) / 3;
    const x2 = pts[i + 1].x - dx[i] / 3;
    const y2 = pts[i + 1].y - (tan[i + 1] * dx[i]) / 3;
    d += ` C ${x1} ${y1} ${x2} ${y2} ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}
