import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadMoney } from "@/lib/performance/money";
import { loadAi } from "@/lib/performance/ai";
import type { PerformanceRange } from "@/lib/performance/types";
import { PerformanceView } from "@/components/performance/performance-view";

// Retrospective firm-performance dashboard. Read-only: it never writes to
// documents, approvals, invoices, or reminders. Firm scoping is handled by RLS
// in the loaders, so a firm only ever sees its own numbers. Phase 2 ships the
// Money section; the AI and automation sections land in later phases.
export const dynamic = "force-dynamic";

function parseRange(value: string | undefined): PerformanceRange {
  return value === "this_month" || value === "all_time"
    ? value
    : "last_3_months"; // sensible default: recent, with enough sample to matter
}

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);

  const [money, ai] = await Promise.all([loadMoney(range), loadAi(range)]);

  return (
    <PerformanceView range={range} locale={locale} money={money} ai={ai} />
  );
}
