"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  STAGE_BG_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";

// The one workflow-stage chip, used everywhere a stage shows in a list: the
// Overview's "My engagements" table and the All-Engagements tables (both render
// through WorklistTable, so that's one call site today).
//
// ── CANOPY'S SHAPE ─────────────────────────────────────────────────────────
//
// The founder, holding up Canopy's engagement list: "replicate canopys UI
// exactly." Its status pill is an OUTLINE — surface background, hairline
// border, a small colour dot, and the label in the normal text colour.
//
// The tinted fill this replaced put six different colour washes down one
// column, which on a full screen is the loudest thing on the page and says
// nothing extra: the dot carries the same colour information in a tenth of the
// area. It also let a stage pill out-shout the engagement's own name, which is
// the thing you are actually reading for.
//
// Hover stays put because this is a label, not a control; only the stepper's
// current node is clickable.
export function StageChip({
  stage,
  className,
}: {
  stage: EngagementStage;
  className?: string;
}) {
  const t = useTranslations("Stage");
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-border/70 bg-background font-normal text-foreground",
        className,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", STAGE_BG_CLASS[stage])}
        aria-hidden
      />
      {t(stageLabelKey(stage))}
    </Badge>
  );
}
