"use client";

import { useLocale, useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";
import { PaymentBadge } from "@/components/payments/payment-badge";
import type { PaymentsListRow } from "@/lib/db/payment-requests";

// Read-only list of payments: which engagement, how much, when, and whether the
// client paid. Used firm-wide in the Payments settings and per-client on the
// client page (showClient=false there, since the client is already the page).
export function PaymentsList({
  rows,
  showClient = true,
  currentUserId,
}: {
  rows: PaymentsListRow[];
  showClient?: boolean;
  // When set, an invoice sent by SOMEONE ELSE shows a "Sent by {name}" tag, so a
  // firm sees which teammate billed a client. Own sends (and solo firms) show
  // nothing. Omit it to never show attribution.
  currentUserId?: string;
}) {
  const t = useTranslations("Engagements");
  const locale = (useLocale() === "fr" ? "fr" : "en") as AppLocale;

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("payments_list_empty")}</p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/50">
      {rows.map((r) => {
        const senderLabel =
          r.requestedByName && r.requestedByUserId !== currentUserId
            ? r.requestedByName
            : null;
        return (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {r.engagementTitle ?? "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {/* The invoice number leads — this list is the invoice history. */}
              {r.invoiceNumber ? `${r.invoiceNumber} · ` : ""}
              {showClient && r.clientName ? `${r.clientName} · ` : ""}
              {formatDate(r.createdAt, locale, "medium")}
              {senderLabel
                ? ` · ${t("payments_sent_by", { name: senderLabel })}`
                : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {r.invoiceKind === "generated" && (
              <a
                href={`/api/invoices/${r.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                aria-label={t("invoice_view_pdf")}
                title={t("invoice_view_pdf")}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <FileText className="size-4" />
              </a>
            )}
            <span className="text-sm tabular-nums">
              {formatCurrency(r.amountCents / 100, locale)}
            </span>
            <PaymentBadge status={r.status} />
          </div>
        </li>
        );
      })}
    </ul>
  );
}
