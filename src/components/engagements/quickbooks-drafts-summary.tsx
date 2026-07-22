import { getTranslations } from "next-intl/server";
import { BookOpen, TriangleAlert, CheckCircle2, Ban } from "lucide-react";
import { summarizeDrafts, type DraftItem } from "@/lib/quickbooks/draft-summary";
import { formatCurrency, type AppLocale } from "@/lib/format";

// Engagement-level roll-up of the QuickBooks drafts, shown at the top of the
// checklist tab so the accountant sees "here's what's drafted" at a glance.
// Counts the accountant's resolved picks. Renders nothing when there are no drafts.
export async function QuickbooksDraftsSummary({
  drafts,
  locale,
  provider = "quickbooks",
}: {
  drafts: DraftItem[];
  locale: AppLocale;
  // The client's bookkeeping product, so the header reads "Xero drafts" for a
  // Xero client instead of the QuickBooks default (a client is EITHER, never both).
  provider?: "quickbooks" | "xero";
}) {
  if (drafts.length === 0) return null;
  const t = await getTranslations("Quickbooks");
  const s = summarizeDrafts(drafts);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">
        {provider === "xero" ? t("summary_label_xero") : t("summary_label")}
      </span>
      <span className="text-muted-foreground">
        {t("summary_drafts", { count: s.total })}
      </span>
      {s.needsInput > 0 && (
        <span className="inline-flex items-center gap-1 text-warning">
          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          {t("summary_needs_input", { count: s.needsInput })}
        </span>
      )}
      {s.approved > 0 && (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {t("summary_approved", { count: s.approved })}
        </span>
      )}
      {s.dismissed > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Ban className="h-3 w-3" aria-hidden="true" />
          {t("summary_dismissed", { count: s.dismissed })}
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
