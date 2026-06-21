import { getTranslations } from "next-intl/server";
import { BookOpen, TriangleAlert } from "lucide-react";
import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";
import { summarizeDrafts } from "@/lib/quickbooks/draft-summary";
import { formatCurrency, type AppLocale } from "@/lib/format";

// Engagement-level roll-up of the QuickBooks drafts, shown at the top of the
// checklist tab so the accountant sees "here's what I drafted" at a glance.
// Read-only; renders nothing when there are no drafts.
export async function QuickbooksDraftsSummary({
  suggestions,
  locale,
}: {
  suggestions: TransactionSuggestion[];
  locale: AppLocale;
}) {
  if (suggestions.length === 0) return null;
  const t = await getTranslations("Quickbooks");
  const s = summarizeDrafts(suggestions);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{t("summary_label")}</span>
      <span className="text-muted-foreground">
        {t("summary_drafts", { count: s.total })}
      </span>
      {s.needsInput > 0 && (
        <span className="inline-flex items-center gap-1 text-warning">
          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          {t("summary_needs_input", { count: s.needsInput })}
        </span>
      )}
      {s.totalCad != null && (
        <span className="ml-auto tabular-nums text-muted-foreground">
          {t("summary_total", { amount: formatCurrency(s.totalCad, locale) })}
          {s.hasForeignCurrency ? " +" : ""}
        </span>
      )}
    </div>
  );
}
