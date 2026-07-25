// Period naming for spawned occurrences: "Monthly bookkeeping - March 2027" /
// "Tenue de livres mensuelle - mars 2027". Pure — unit-tested directly.
//
// The label is stamped in the CLIENT's locale: the title lands in the client's
// invite email and portal, and one string must serve everyone. French month
// names come from Intl (fr-CA), which already lowercases them per Quebec
// French convention. Quarters use Q (EN) / T for "trimestre" (FR).

import type { LocalDate, RecurringFrequency } from "./schedule";

export function periodLabel(
  frequency: RecurringFrequency,
  d: LocalDate,
  locale: "en" | "fr",
): string {
  // Custom cycles are month-based and can repeat several times a year, so they
  // take the month-and-year label too. Falling through to the year-only default
  // would give every occurrence of an every-2-months series the SAME title.
  if (frequency === "monthly" || frequency === "custom") {
    // Mid-month UTC noon so no timezone can shift the month.
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(d.year, d.month - 1, 15, 12)));
  }
  if (frequency === "quarterly") {
    const quarter = Math.ceil(d.month / 3);
    return `${locale === "fr" ? "T" : "Q"}${quarter} ${d.year}`;
  }
  return String(d.year);
}

// "<series title> - <period>". Plain hyphen by design (the repo strips em
// dashes from client-facing template copy).
export function occurrenceTitle(
  baseTitle: string,
  frequency: RecurringFrequency,
  d: LocalDate,
  locale: "en" | "fr",
): string {
  return `${baseTitle} - ${periodLabel(frequency, d, locale)}`;
}
