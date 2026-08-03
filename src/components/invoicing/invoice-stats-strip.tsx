import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatCurrency, type AppLocale } from "@/lib/format";
import type { BillingStats } from "@/lib/invoices/stats";

// Four operational numbers across the top of the Invoices tab, in the same thin
// hairline strip the Overview uses — no card chrome, just a rule per stat.
//
// Outstanding and Overdue are LINKS into the filtered list, because the useful
// next move after reading "$8,400 overdue" is seeing which invoices those are.
// Collected and the average are not: there is no list that means "collected
// this month" without inventing a date-range filter the person did not ask for.
//
// A sample of fewer than five paid invoices shows the count instead of a
// confident average. An "average days to paid" built on two invoices is noise
// wearing a number's clothes.
const THIN_SAMPLE = 5;

export async function InvoiceStatsStrip({
  stats,
  locale,
}: {
  stats: BillingStats;
  locale: AppLocale;
}) {
  const t = await getTranslations("FirmBilling");

  const money = (cents: number) => formatCurrency(cents / 100, locale);

  const avgValue =
    stats.averageDaysToPaid == null
      ? t("stat_avg_days_none")
      : t("stat_avg_days_value", { days: stats.averageDaysToPaid });
  const avgHint =
    stats.averageDaysToPaid != null && stats.averageSampleSize < THIN_SAMPLE
      ? t("stat_avg_days_thin", { count: stats.averageSampleSize })
      : null;

  const items = [
    {
      key: "outstanding",
      value: money(stats.outstandingCents),
      label: t("stat_outstanding"),
      href: "/billing?status=unpaid",
      tone: "",
    },
    {
      key: "overdue",
      value: money(stats.overdueCents),
      label: t("stat_overdue"),
      href: "/billing?status=overdue",
      // The only number here that is allowed to shout, and only when it is
      // actually above zero — a red $0.00 is a false alarm every morning.
      tone: stats.overdueCents > 0 ? "text-destructive" : "",
    },
    {
      key: "collected",
      value: money(stats.collectedThisMonthCents),
      label: t("stat_collected"),
      href: null,
      tone: "",
    },
    {
      key: "avg",
      value: avgValue,
      label: t("stat_avg_days"),
      href: null,
      tone: "",
      hint: avgHint,
    },
  ] as const;

  return (
    <section aria-label={t("page_title")} className="mb-6">
      <ul className="grid max-w-[1100px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-x-8 sm:gap-y-0">
        {items.map((s) => {
          const body = (
            <>
              <span
                className={`block text-2xl font-[650] leading-none tracking-[-0.02em] tabular-nums ${s.tone || "text-foreground"}`}
              >
                {s.value}
              </span>
              <span className="block truncate text-[12.5px] text-muted-foreground transition-colors group-hover:text-foreground/80">
                {s.label}
              </span>
              {"hint" in s && s.hint ? (
                <span className="block truncate text-[11px] text-muted-foreground/70">
                  {s.hint}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={s.key} className="min-w-0">
              {s.href ? (
                <Link
                  href={s.href}
                  className="group flex min-w-0 flex-col gap-1 rounded-r-sm border-l border-border/50 pl-3 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pl-4"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-col gap-1 border-l border-border/50 pl-3 sm:pl-4">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
