"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import {
  PERFORMANCE_RANGES,
  type AiSection as AiData,
  type MoneySection as MoneyData,
  type PerformanceRange,
} from "@/lib/performance/types";
import { perfCopy } from "./copy";
import { SegmentedControl } from "./segmented-control";
import { MoneySection } from "./money-section";
import { AiSection } from "./ai-section";

// Client shell for the Performance page. The range lives in the URL (?range=),
// so switching it is a soft navigation: the server re-loads the numbers and this
// component stays mounted, which lets the stat count-ups and bars animate from
// the old values to the new ones instead of snapping. useTransition keeps the
// old numbers on screen (dimmed) until the new ones arrive.
export function PerformanceView({
  range,
  locale,
  money,
  ai,
}: {
  range: PerformanceRange;
  locale: AppLocale;
  money: MoneyData;
  ai: AiData;
}) {
  const copy = perfCopy(locale);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const setRange = (next: PerformanceRange) => {
    if (next === range) return;
    startTransition(() => {
      router.push(`${pathname}?range=${next}`, { scroll: false });
    });
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {copy.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
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
      </header>

      <div
        className={cn(
          "space-y-6 transition-opacity duration-200",
          pending && "opacity-60",
        )}
      >
        <MoneySection data={money} locale={locale} copy={copy.money} />
        <AiSection data={ai} locale={locale} copy={copy.ai} />
      </div>
    </div>
  );
}
