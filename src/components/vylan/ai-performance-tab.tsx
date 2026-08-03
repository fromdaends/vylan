"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import {
  PERFORMANCE_RANGES,
  type AiSection as AiData,
  type AutomationSection as AutoData,
  type PerformanceRange,
} from "@/lib/performance/types";
import { perfCopy } from "@/components/performance/copy";
import { SegmentedControl } from "@/components/performance/segmented-control";
import { AiSection } from "@/components/performance/ai-section";
import { AutomationRow } from "@/components/performance/automation-row";
import { ResetStats } from "@/components/performance/reset-stats";

// What survived the Performance page: how well the AI agrees with the humans,
// and what Vylan did on its own. Both belong beside Automated jobs on the Vylan
// hub — they are all answers to "what is this thing doing for me?" — which the
// standalone page never was.
//
// The Money half is gone: Billing's stat strip replaced it, and the chart was
// deliberately not ported. The Documents view went with it.
//
// This is the old PerformanceView with the money and documents branches removed
// and the range in ?range= kept exactly as it was: switching it is a soft
// navigation, so the server re-loads the numbers while this component stays
// mounted and the count-ups animate from the old values to the new ones rather
// than snapping. The one change is that the range now rides alongside ?tab=ai,
// so switching it cannot bounce you back to Automated jobs.
export function AiPerformanceTab({
  range,
  locale,
  ai,
  automation,
  resetAt,
  isOwner,
}: {
  range: PerformanceRange;
  locale: AppLocale;
  ai: AiData;
  automation: AutoData;
  // Firm's "reset stats" baseline (ISO instant) or null when not reset.
  resetAt: string | null;
  // Only firm owners get the reset / undo controls.
  isOwner: boolean;
}) {
  const copy = perfCopy(locale);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const setRange = (next: PerformanceRange) => {
    if (next === range) return;
    startTransition(() => {
      // Keep ?tab=ai: without it the range switch would drop the reader back
      // onto Automated jobs mid-thought.
      router.push(`${pathname}?tab=ai&range=${next}`, { scroll: false });
    });
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <ResetStats
          resetAt={resetAt}
          isOwner={isOwner}
          locale={locale}
          copy={copy.reset}
        />
        <div className="flex items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-[5rem] text-right text-xs text-muted-foreground"
          >
            {pending ? copy.loading : ""}
          </span>
          <SegmentedControl
            ariaLabel={copy.rangeLabel}
            value={range}
            onChange={setRange}
            options={PERFORMANCE_RANGES.map((r) => ({
              value: r,
              label: copy.ranges[r],
            }))}
          />
        </div>
      </div>

      <div
        className={cn(
          "transition-opacity duration-200",
          pending && "opacity-60",
        )}
      >
        <AiSection data={ai} locale={locale} copy={copy.ai} />
        <AutomationRow
          data={automation}
          locale={locale}
          copy={copy.automation}
        />
      </div>
    </div>
  );
}
