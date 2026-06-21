// Locale-aware formatters for dates, currency, and file sizes.
//
// Always pass an explicit locale ('fr' or 'en') rather than relying on the
// browser default — server-rendered pages don't have a browser locale to
// look at. We use the Canadian variants (fr-CA / en-CA) so currency shows
// up the way Quebec accountants expect:
//   FR: 1 234,56 $   EN: $1,234.56
//   FR: 15 mars 2026 EN: March 15, 2026

export type AppLocale = "fr" | "en";

function intlLocale(locale: AppLocale): string {
  return locale === "fr" ? "fr-CA" : "en-CA";
}

export function formatDate(
  input: string | Date | null | undefined,
  locale: AppLocale,
  style: "short" | "medium" | "long" = "medium",
): string {
  if (input == null) return "—";
  const d = typeof input === "string" ? parseDateInput(input) : input;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { year: "numeric", month: "2-digit", day: "2-digit" }
      : style === "long"
        ? { year: "numeric", month: "long", day: "numeric", weekday: "long" }
        : { year: "numeric", month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(intlLocale(locale), opts).format(d);
}

// "YYYY-MM-DD" (Postgres `date` column shape) is naive — Date parses it as
// UTC midnight and the user's local timezone can shove it to the previous
// day. Normalize to a local Date so "2026-04-30" always shows as April 30.
function parseDateInput(s: string): Date | null {
  const yyyyMmDd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (yyyyMmDd) {
    return new Date(
      Number(yyyyMmDd[1]),
      Number(yyyyMmDd[2]) - 1,
      Number(yyyyMmDd[3]),
    );
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatCurrency(
  amount: number | null | undefined,
  locale: AppLocale,
  fractionDigits = 2,
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatNumber(
  n: number,
  locale: AppLocale,
  fractionDigits?: number,
): string {
  return new Intl.NumberFormat(
    intlLocale(locale),
    fractionDigits != null
      ? {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }
      : undefined,
  ).format(n);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Relative time, "il y a 3 jours" / "3 days ago".
export function formatRelative(
  date: string | Date | null | undefined,
  locale: AppLocale,
  now: Date = new Date(),
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const fmt = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
  });
  const diffMs = d.getTime() - now.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) {
    return locale === "fr" ? "à l'instant" : "just now";
  }
  if (Math.abs(minutes) < 60) return fmt.format(minutes, "minute");
  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return fmt.format(hours, "hour");
  const days = Math.round(diffMs / 86_400_000);
  return fmt.format(days, "day");
}
