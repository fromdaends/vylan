"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";
import { PaymentBadge } from "@/components/payments/payment-badge";
import type { PaymentsListRow } from "@/lib/db/payment-requests";

// Read-only list of payments: which engagement, how much, when, and whether the
// client paid. Used firm-wide in the Payments settings and per-client on the
// client page (showClient=false there, since the client is already the page).
export function PaymentsList({
  rows,
  showClient = true,
}: {
  rows: PaymentsListRow[];
  showClient?: boolean;
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
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {r.engagementTitle ?? "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {showClient && r.clientName ? `${r.clientName} · ` : ""}
              {formatDate(r.createdAt, locale, "medium")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm tabular-nums">
              {formatCurrency(r.amountCents / 100, locale)}
            </span>
            <PaymentBadge status={r.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
