"use client";

// The engagement's Time line — THE flat-fee reality check (timer v2).
//
//   Time: 14h 20m · $1,320 value · flat fee $1,100
//
// One quiet line near the details, answering the only question time answers
// on this page: is the flat fee above or below what the work actually took?
// Hover (or focus) expands the per-person split.
//
// WHO SEES WHAT: hours are firm-shared (standing ruling); the VALUE half
// renders only when the server computed it — the page passes null for viewers
// the billing table's RLS gave nothing to, so a staff member reads
// "Time: 14h 20m" and no dollars. A partial value (some entries carry no
// rate) says so rather than posing as the total.

import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMinutes } from "@/lib/time/duration";
import { formatCurrency, type AppLocale } from "@/lib/format";

export function EngagementTimeLine({
  totalMinutes,
  valueCents,
  uncostedMinutes,
  flatFeeCents,
  perPerson,
  locale,
}: {
  totalMinutes: number;
  /** Null = the viewer may not see values (or none are recorded). */
  valueCents: number | null;
  /** Minutes carrying no billable snapshot — makes a partial value honest. */
  uncostedMinutes: number;
  flatFeeCents: number | null;
  perPerson: { name: string; minutes: number }[];
  locale: AppLocale;
}) {
  const t = useTranslations("Time");
  if (totalMinutes <= 0) return null;

  // The shared formatter with the VIEWER's locale — Intl with `undefined`
  // resolves to the SERVER's locale during SSR and the browser's after
  // hydration: wrong French formatting AND a hydration mismatch, in one.
  const money = (cents: number) =>
    formatCurrency(cents / 100, locale, { fractionDigits: 0 });

  const underwater =
    valueCents != null && flatFeeCents != null && valueCents > flatFeeCents;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="inline-flex cursor-default flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("line_label")}
            </span>
            <span className="tabular-nums">{formatMinutes(totalMinutes)}</span>
            {valueCents != null && (
              <>
                <span aria-hidden>·</span>
                <span className={underwater ? "font-medium text-destructive" : undefined}>
                  {t("line_value", { amount: money(valueCents) })}
                  {uncostedMinutes > 0 ? "*" : ""}
                </span>
              </>
            )}
            {flatFeeCents != null && (
              <>
                <span aria-hidden>·</span>
                <span>{t("line_flat_fee", { amount: money(flatFeeCents) })}</span>
              </>
            )}
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] space-y-1 text-xs">
          {perPerson.map((p) => (
            <p key={p.name} className="flex justify-between gap-4">
              <span>{p.name}</span>
              <span className="tabular-nums">{formatMinutes(p.minutes)}</span>
            </p>
          ))}
          {valueCents != null && uncostedMinutes > 0 && (
            <p className="pt-1 text-muted-foreground">
              {t("line_uncosted", { duration: formatMinutes(uncostedMinutes) })}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
