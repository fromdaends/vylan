// Day-of-month formatting for custom repeat schedules. Pure — unit-tested
// directly, and shared by the picker's trigger label and any summary copy.

export const DAYS_IN_LONGEST_MONTH = 31;

// Days that don't exist in every month. The scheduler clamps these to the last
// day of a short month (see nextSpawn), and the picker flags them so the
// accountant knows before choosing rather than after.
export function isShortMonthDay(day: number): boolean {
  return day >= 29;
}

// "25th" / "1st" in English; "25" / "1er" in French (Quebec convention: only
// the first takes an ordinal marker). Used for the picker's trigger so the
// chosen day reads as a date rather than a bare number.
export function ordinalDay(day: number, locale: "en" | "fr"): string {
  const n = Math.floor(day);
  if (!Number.isFinite(n)) return "";
  if (locale === "fr") return n === 1 ? "1er" : String(n);
  // English: 11/12/13 are the irregular ones ("11th", not "11st").
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
