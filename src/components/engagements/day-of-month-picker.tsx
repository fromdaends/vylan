"use client";

// The calendar picker for a custom repeat schedule's day-of-month.
//
// WHY THIS IS NOT A REAL DATE CALENDAR: the value is a day of the MONTH for a
// recurring schedule, not one specific date. A weekday-column calendar would
// state something false — the 25th is a Thursday one cycle and a Sunday the
// next — and would force a meaningless month/year choice. So this is a
// month-SHAPED grid of 1-31: it reads like a calendar page and is clickable
// like one, without implying a weekday or a particular month.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DAYS_IN_LONGEST_MONTH,
  isShortMonthDay,
  ordinalDay,
} from "@/lib/recurring/day-of-month";

const DAYS = Array.from({ length: DAYS_IN_LONGEST_MONTH }, (_, i) => i + 1);

export function DayOfMonthPicker({
  value,
  onChange,
  locale,
  id,
}: {
  // Currently chosen day (1-31), or null when nothing is chosen yet.
  value: number | null;
  onChange: (day: number) => void;
  locale: "fr" | "en";
  id?: string;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 font-normal"
          aria-label={t("repeat_custom_on_day_label")}
        >
          <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />
          {value != null
            ? ordinalDay(value, locale)
            : t("repeat_custom_pick_day")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div
          className="grid grid-cols-7 gap-1"
          role="group"
          aria-label={t("repeat_custom_on_day_label")}
        >
          {DAYS.map((day) => {
            const selected = day === value;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  onChange(day);
                  setOpen(false);
                }}
                aria-pressed={selected}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-primary font-medium text-primary-foreground hover:bg-primary"
                    : "hover:bg-secondary",
                  // 29/30/31 don't exist in every month. Muted rather than
                  // disabled — they're legal choices, they just clamp.
                  !selected && isShortMonthDay(day) && "text-muted-foreground",
                )}
              >
                {day}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 max-w-56 text-xs leading-snug text-muted-foreground">
          {t("repeat_custom_hint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
