// Small formatting helpers specific to the Performance visuals. Money math is
// in integer cents everywhere; these convert for display only.

import { formatCurrency, type AppLocale } from "@/lib/format";
import { PERFORMANCE_TZ } from "@/lib/performance/range";
import type { MoneyBucketGranularity } from "@/lib/performance/types";

// Whole-dollar currency for the glance headlines (e.g. "$48,250"). The exact,
// to-the-cent figures live in Settings > Payments history.
export function centsToCurrency(
  cents: number,
  locale: AppLocale,
  digits = 0,
): string {
  return formatCurrency(cents / 100, locale, digits);
}

// Label for one money bucket: a short month ("Jul") or a day-of-month ("21"),
// formatted in Eastern time so it matches how the bucket was computed.
export function bucketLabel(
  iso: string,
  granularity: MoneyBucketGranularity,
  locale: AppLocale,
): string {
  const intl = locale === "fr" ? "fr-CA" : "en-CA";
  const opts: Intl.DateTimeFormatOptions =
    granularity === "day"
      ? { timeZone: PERFORMANCE_TZ, day: "numeric" }
      : { timeZone: PERFORMANCE_TZ, month: "short" };
  return new Intl.DateTimeFormat(intl, opts).format(new Date(iso));
}

// A fuller label for the hover tooltip: "July 2026" for a month, "Jul 21" for a
// day, formatted in Eastern time to match how the bucket was computed.
export function bucketLabelFull(
  iso: string,
  granularity: MoneyBucketGranularity,
  locale: AppLocale,
): string {
  const intl = locale === "fr" ? "fr-CA" : "en-CA";
  const opts: Intl.DateTimeFormatOptions =
    granularity === "day"
      ? { timeZone: PERFORMANCE_TZ, month: "short", day: "numeric" }
      : { timeZone: PERFORMANCE_TZ, month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(intl, opts).format(new Date(iso));
}

// A one-decimal day count that drops a trailing ".0" (7 not 7.0, 7.5 stays 7.5).
export function formatDays(days: number, locale: AppLocale): string {
  const rounded = Math.round(days * 10) / 10;
  const intl = locale === "fr" ? "fr-CA" : "en-CA";
  return new Intl.NumberFormat(intl, {
    maximumFractionDigits: 1,
  }).format(rounded);
}
