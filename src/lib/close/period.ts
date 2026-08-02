// Which month are we closing, and what dates does it cover?
//
// Pure calendar arithmetic, no I/O, no Date-with-a-timezone. Everything here
// works on the string "2026-07" and ISO calendar dates, because that is what
// both ends of this feature speak: QuickBooks returns calendar dates with no
// zone, and the close table stores a plain `date`.
//
// WHY NOT `new Date(...)`. Because a month boundary is exactly where a timezone
// silently eats a day. `new Date("2026-07-01")` is midnight UTC, which in
// Toronto is 8pm on 30 June — so a "July" range built through a Date object
// starts in June for every user in Canada, and the first day of the month
// lands in the wrong close. All of this is string and integer maths instead.

/** A month, as "YYYY-MM". */
export type PeriodKey = string;

const KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && KEY_RE.test(v);
}

export function periodParts(key: PeriodKey): { year: number; month: number } {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`not a period key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function periodKey(year: number, month: number): PeriodKey {
  return `${year}-${pad(month)}`;
}

/** The first day of the month, as an ISO date — what the table stores. */
export function periodStart(key: PeriodKey): string {
  const { year, month } = periodParts(key);
  return `${year}-${pad(month)}-01`;
}

/** The last day of the month, as an ISO date. */
export function periodEnd(key: PeriodKey): string {
  const { year, month } = periodParts(key);
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

// Leap years included, so February closes on the 29th when it should. A ledger
// scan that stopped on the 28th would miss a whole day of transactions in the
// one month a firm is least likely to double-check.
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function shiftPeriod(key: PeriodKey, months: number): PeriodKey {
  const { year, month } = periodParts(key);
  // Zero-based month arithmetic, then floor-divide — so going back from January
  // lands on the previous December rather than month 0 of the same year.
  const zero = year * 12 + (month - 1) + months;
  return periodKey(Math.floor(zero / 12), (zero % 12) + 1);
}

/** The period a given ISO date falls in. */
export function periodOf(isoDate: string): PeriodKey {
  return isoDate.slice(0, 7);
}

// The month a firm is most likely to be working on: LAST month.
//
// You close July during August. Defaulting to the current month would open the
// board on a month nobody can finish yet — half its transactions have not
// happened — and every visit would start with the same correction.
export function defaultPeriod(todayIso: string): PeriodKey {
  return shiftPeriod(periodOf(todayIso), -1);
}

const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

export function periodLabel(key: PeriodKey, locale?: "en" | "fr"): string {
  const { year, month } = periodParts(key);
  const name = (locale === "fr" ? MONTHS_FR : MONTHS_EN)[month - 1]!;
  return `${name} ${year}`;
}
