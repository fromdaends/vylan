"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  STAGE_BG_CLASS,
  STAGE_CHIP_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";
import { FILTERABLE_STAGES } from "@/lib/engagements/stage-filter";

// The stage filter row on the Active engagements table: "All" plus one chip per
// stage, in workflow order, each carrying how many engagements sit there.
//
// Single-select by design — an engagement is at exactly ONE stage, so combining
// two chips could only ever mean OR, which is a different question ("show me
// everything that isn't done") than the one this row answers ("show me what's
// at X"). Clicking the active chip again, or All, clears.
//
// Styling follows the existing chip conventions and the stage hues: a selected
// chip wears its stage's own subtle tint (never a heavy fill), an unselected one
// is quiet with just a colour dot tying it to the chip it filters for. Thin
// line, no container — "mesh, don't box".
export function StageFilterChips({
  counts,
  selected,
  onSelect,
  className,
}: {
  // Per-stage totals. Must be computed from the rows with every OTHER filter
  // (scope + search) applied but NOT this one — so each count is exactly what
  // clicking would reveal, and picking one chip doesn't zero the rest.
  counts: Record<EngagementStage, number>;
  selected: EngagementStage | null;
  // null = clear the filter (the All chip, or clicking the active chip again).
  onSelect: (stage: EngagementStage | null) => void;
  className?: string;
}) {
  const t = useTranslations("Stage");

  return (
    <div
      role="group"
      aria-label={t("filter_label")}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      <button
        type="button"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        className={cn(
          "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected === null
            ? "bg-secondary text-foreground shadow-[inset_0_1px_0_0_var(--color-border)]"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
        )}
      >
        {t("filter_all")}
      </button>

      {FILTERABLE_STAGES.map((stage) => {
        const count = counts[stage] ?? 0;
        const active = selected === stage;
        const label = t(stageLabelKey(stage));
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={active}
            // The visible text is "Collecting documents (12)"; the count reads
            // as a bare number to a screen reader without this, so the label
            // spells the relationship out.
            aria-label={t("filter_chip", { label, count })}
            onClick={() => onSelect(active ? null : stage)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? STAGE_CHIP_CLASS[stage]
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              // An empty stage stays visible — its absence is information ("no
              // one is waiting to sign") and a row of chips that reshuffles as
              // work moves is harder to aim at than one that holds still. Kept
              // clickable: the empty state explains itself, and disabling the
              // chip you just filtered to would strand it.
              count === 0 && !active && "opacity-40",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STAGE_BG_CLASS[stage],
                // The dot carries the hue on an unselected chip; on a selected
                // one the tint already does, so it would just be noise.
                active && "opacity-70",
              )}
            />
            <span aria-hidden>{label}</span>
            <span aria-hidden className="tabular-nums opacity-70">
              ({count})
            </span>
          </button>
        );
      })}
    </div>
  );
}
