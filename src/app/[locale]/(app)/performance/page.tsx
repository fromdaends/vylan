import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadMoney } from "@/lib/performance/money";
import { loadAi } from "@/lib/performance/ai";
import { loadAutomation } from "@/lib/performance/automation";
import { loadDocuments } from "@/lib/performance/documents";
import type { PerformanceRange } from "@/lib/performance/types";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
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

  // The firm's "reset stats" baseline (migration 0880) clamps every range-scoped
  // stat; the current user's role gates the owner-only reset control. Read both
  // first so the loaders can honour the baseline. `performance_reset_at` may be
  // undefined until 0880 is applied — treated as "no reset".
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  const resetAt = firm?.performance_reset_at ?? null;
  const parsedReset = resetAt ? Date.parse(resetAt) : NaN;
  const resetAtMs = Number.isFinite(parsedReset) ? parsedReset : null;
  const isOwner = user?.role === "owner";

  // `undefined` nowMs lets each loader read the clock itself (a lib function),
  // keeping this render pure; the reset baseline is threaded as the 3rd arg.
  const [money, ai, automation, documents] = await Promise.all([
    loadMoney(range, undefined, resetAtMs),
    loadAi(range, undefined, resetAtMs),
    loadAutomation(range, undefined, resetAtMs),
    loadDocuments(range, undefined, resetAtMs),
  ]);

  return (
    <PerformanceView
      range={range}
      locale={locale}
      money={money}
      ai={ai}
      automation={automation}
      documents={documents}
      resetAt={resetAt}
      isOwner={isOwner}
    />
  );
}
