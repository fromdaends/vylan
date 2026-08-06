"use client";

// The two card shapes the Work dashboard is built from — Canopy's, copied.
//
// Founder: "start with the dashboard for tasks + engagements combined that
// looks and replicates Canopys exactly. Literally copy it exactly."
//
// So the shapes are theirs: a KPI card is a title, an optional description
// line and one very large number; a chart card is a title, a legend on the
// right, and the plot underneath. Both reveal their controls on hover rather
// than parking them on the card — which is Canopy's behaviour AND the
// founder's standing objection to buttons that sit there doing nothing.
//
// ⚠️ ONE COMPONENT PER SHAPE, used by every tab. The tasks tab and the
// engagements tab are the same four cards over different numbers; two copies
// would drift the first time a padding changed.

import { type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The hover strip Canopy puts in the top-right of every card. Ours carries
 *  what we can actually do: go to the list this number came from. */
function CardMenu({
  exploreHref,
  exploreLabel,
  menuLabel,
  offset = false,
}: {
  exploreHref?: string;
  exploreLabel: string;
  menuLabel: string;
  /** A bell is parked at right-2.5, so shift out from under it. */
  offset?: boolean;
}) {
  if (!exploreHref) return null;
  return (
    <div
      className={cn(
        "absolute top-2.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100",
        offset ? "right-11" : "right-2.5",
      )}
    >
      {/* Canopy's "Explore" opens ThoughtSpot's query builder. We have no query
          builder and will not pretend to — ours goes to the list the number is
          counting, filtered the same way, which is the question somebody
          clicking a KPI is actually asking. */}
      <Link
        href={exploreHref}
        className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {exploreLabel}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={menuLabel}
            className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={exploreHref}>{exploreLabel}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Canopy's KPI card: a title, an optional line under it, one big number. */
export function KpiCard({
  title,
  description,
  value,
  tone = "default",
  exploreHref,
  exploreLabel,
  menuLabel,
  bell,
}: {
  title: string;
  description?: string;
  /** Already formatted — the caller decides "141" versus "14.02%". */
  value: string;
  /** Overdue is the one number on the strip that means something is wrong. */
  tone?: "default" | "danger";
  exploreHref?: string;
  exploreLabel: string;
  menuLabel: string;
  /** Canopy's alert bell. Sits BEFORE Explore in the hover strip because it is
   *  the only control here that changes anything. */
  bell?: ReactNode;
}) {
  return (
    <div className="group/card relative rounded-xl border border-border bg-card px-5 py-4">
      {/* The bell lives OUTSIDE the hover strip: a card you already watch has
          to say so at rest, or the whole point of glancing is lost. */}
      {bell && <div className="absolute right-2.5 top-2.5 z-10">{bell}</div>}
      <CardMenu
        exploreHref={exploreHref}
        exploreLabel={exploreLabel}
        menuLabel={menuLabel}
        offset={Boolean(bell)}
      />
      <p className="pr-20 text-[15px] font-semibold leading-tight tracking-tight">
        {title}
      </p>
      {description && (
        <p className="mt-0.5 text-[13px] leading-tight text-muted-foreground">
          {description}
        </p>
      )}
      {/* Canopy's number is enormous and that is the whole design — a KPI card
          you have to read twice has failed. Tabular figures so a strip of four
          does not jiggle as they change. */}
      <p
        className={cn(
          "mt-5 text-[40px] font-semibold leading-none tracking-tight tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Canopy's chart card: title top-left, legend top-right, plot underneath. */
export function ChartCard({
  title,
  legend,
  children,
  exploreHref,
  exploreLabel,
  menuLabel,
  empty,
  plotHeight = "default",
}: {
  title: string;
  legend?: { label: string; color: string }[];
  children: ReactNode;
  exploreHref?: string;
  exploreLabel: string;
  menuLabel: string;
  /** Shown instead of the plot when there is nothing to draw. A chart with no
   *  bars reads as broken; a sentence saying why does not. */
  empty?: string;
  /** The card's ONE size decision, kept here rather than leaking per-chart
   *  pixel heights into pages (a child taller than the wrapper silently
   *  clips — the Insights quadrant shipped at 320px inside this 260px box).
   *  "tall" is for centerpiece plots like the quadrant. */
  plotHeight?: "default" | "tall";
}) {
  const isEmpty = Boolean(empty);
  return (
    <div className="group/card relative rounded-xl border border-border bg-card p-5">
      <CardMenu
        exploreHref={exploreHref}
        exploreLabel={exploreLabel}
        menuLabel={menuLabel}
      />
      <div className="flex items-start justify-between gap-4">
        <h3 className="pr-20 text-[15px] font-semibold leading-tight tracking-tight">
          {title}
        </h3>
      </div>

      {isEmpty ? (
        <p
          className={cn(
            "flex items-center justify-center text-center text-sm text-muted-foreground",
            plotHeight === "tall" ? "h-[340px]" : "h-[260px]",
          )}
        >
          {empty}
        </p>
      ) : (
        <>
          {legend && legend.length > 0 && (
            // Canopy puts the legend at the top-right of the plot rather than
            // under it, which keeps the x-axis labels the only thing along the
            // bottom edge.
            <ul className="mt-1 flex flex-wrap justify-end gap-x-4 gap-y-1">
              {legend.map((l) => (
                <li
                  key={l.label}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          <div
            className={cn(
              "mt-2 w-full",
              plotHeight === "tall" ? "h-[340px]" : "h-[260px]",
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

/** The categorical palette the charts share.
 *
 *  Canopy's is blue + amber + red-ish, and theirs comes from ThoughtSpot's
 *  defaults. Ours starts at the app's own accent so a chart looks like it
 *  belongs to Vylan, then walks a hue circle — deliberately NOT the status
 *  colours, which a firm chooses and which the donut uses for real. */
export const SERIES_COLORS = [
  "var(--accent)",
  "#f59e0b",
  "#10b981",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#6366f1",
] as const;

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}
