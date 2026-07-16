"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  STAGE_CHIP_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";

// The one workflow-stage chip, used everywhere a stage shows in a list: the
// Overview's "My engagements" table and the All-Engagements tables (both render
// through WorklistTable, so that's one call site today).
//
// Follows the existing chip convention exactly — subtle background tint, colored
// text, transparent border, no heavy fill — matching PaymentBadge. Hover is
// pinned to the same tint because this is a label, not a control; only the
// stepper's current node is clickable.
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
      className={cn(
        "border-transparent font-normal",
        STAGE_CHIP_CLASS[stage],
        className,
      )}
    >
      {t(stageLabelKey(stage))}
    </Badge>
  );
}
