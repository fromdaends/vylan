"use client";

import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Milestone } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  STAGE_BG_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";
import { FILTERABLE_STAGES } from "@/lib/engagements/stage-filter";

// The stage filter on the Active engagements table: ONE control, sitting beside
// the my/all scope picker it mirrors.
//
// This replaced a row of six chips. The chips worked, but they put six labels,
// six counts and six colour dots permanently on screen to answer a question the
// accountant asks occasionally — a lot of furniture for an occasional need. A
// dropdown costs one click to open and gives the screen back the row.
//
// The stage hues live INSIDE the menu rather than on the trigger: they help you
// pick, and they cost nothing when closed.
const ALL = "all";

export function StageFilterSelect({
  counts,
  selected,
  onSelect,
  className,
}: {
  // Per-stage totals. Computed from the rows with every OTHER filter (scope +
  // search) applied but NOT this one — so each count is exactly what choosing
  // it would reveal, and picking one stage doesn't zero the others.
  counts: Record<EngagementStage, number>;
  selected: EngagementStage | null;
  // null = no stage filter (the "All stages" option).
  onSelect: (stage: EngagementStage | null) => void;
  className?: string;
}) {
  const t = useTranslations("Stage");

  return (
    <Select
      value={selected ?? ALL}
      onValueChange={(v) => onSelect(v === ALL ? null : (v as EngagementStage))}
    >
      {/* 17rem, not the 13rem its scope-picker neighbour uses: the longest
          option is French ("En attente de signature (0)" — 176px at 14px Inter),
          which needs ~16.5rem once the leading icon, the colour dot and the
          chevron are counted. At 15rem the count silently clipped in FR while
          looking fine in EN. */}
      <SelectTrigger
        size="sm"
        className={cn("w-[17rem] self-start", className)}
        aria-label={t("filter_label")}
      >
        <Milestone className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder={t("filter_label")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("filter_all")}</SelectItem>
        {FILTERABLE_STAGES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  STAGE_BG_CLASS[stage],
                  // An empty stage reads quieter, but stays listed: its
                  // emptiness is information ("nobody is waiting to sign"), and
                  // a menu that reshuffles as work moves is harder to learn
                  // than one that holds still.
                  counts[stage] === 0 && "opacity-40",
                )}
              />
              {t("filter_chip", {
                label: t(stageLabelKey(stage)),
                count: counts[stage] ?? 0,
              })}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
