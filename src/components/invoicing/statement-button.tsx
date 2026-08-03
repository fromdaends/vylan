"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceListFilters } from "@/lib/invoices/filters";

// "Statement of account" — appears only once a single client is filtered,
// because a statement for "all clients" is not a thing anyone can send.
//
// It inherits the table's CURRENT date range, so what downloads is what the
// accountant is looking at. That is the whole trick: no second date picker to
// keep in step, and the range is already on screen above the button.
//
// A plain <a download>, not a fetch: the browser handles the file, so a slow
// render cannot leave the page in a stuck loading state.
export function StatementButton({
  filters,
  clientName,
}: {
  filters: InvoiceListFilters;
  clientName: string;
}) {
  const t = useTranslations("FirmBilling");
  if (!filters.clientId) return null;

  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  const href = `/api/statements/${filters.clientId}/pdf${qs ? `?${qs}` : ""}`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-secondary/40 px-4 py-3">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("statement_title")}</p>
        <p className="text-xs text-muted-foreground">
          {filters.from || filters.to
            ? t("statement_range_hint")
            : t("statement_all_time_hint", { client: clientName })}
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <a href={href}>{t("statement_generate")}</a>
      </Button>
    </div>
  );
}
