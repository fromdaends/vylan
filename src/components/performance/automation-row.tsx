"use client";

import { Bell, RefreshCw } from "lucide-react";
import { formatNumber, type AppLocale } from "@/lib/format";
import type { AutomationSection as AutoData } from "@/lib/performance/types";
import type { PerfCopy } from "./copy";
import { CountUp } from "./count-up";

// The quiet automation strip: the invisible work Vylan did in range — reminders
// it sent automatically and documents it re-requested after an auto-rejection.
// Deliberately lighter than the Money / AI cards (smaller numbers, softer
// chrome) so it reads as a peripheral footnote, not a headline.
export function AutomationRow({
  data,
  locale,
  copy,
}: {
  data: AutoData;
  locale: AppLocale;
  copy: PerfCopy["automation"];
}) {
  const fmt = (n: number) => formatNumber(Math.round(n), locale);
  const items = [
    {
      icon: <Bell className="size-4 text-icon-indigo" />,
      value: data.remindersSent,
      label: copy.remindersLabel,
      hint: copy.remindersHint,
    },
    {
      icon: <RefreshCw className="size-4 text-icon-cyan" />,
      value: data.reRequestEmails,
      label: copy.reRequestsLabel,
      hint: copy.reRequestsHint,
    },
  ];

  return (
    <section className="mt-10 border-t border-border/60 pt-10 sm:mt-12 sm:pt-12">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {copy.heading}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.label}
            className="min-w-0 sm:pl-6 sm:first:pl-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-border/50"
          >
            <div className="mb-1 flex items-center gap-1.5">
              {it.icon}
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {it.label}
              </span>
            </div>
            <CountUp
              value={it.value}
              format={fmt}
              className="num-display block text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">{it.hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
