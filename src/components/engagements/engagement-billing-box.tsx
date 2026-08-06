// THE BILLING BOX (design 2a) — the invoice's state, right rail, replacing
// the header payment chip.
//
// A presenter with slots: "View invoice" is the page's InvoiceOptionsDialog
// behind a link-styled trigger (the ONE invoice flow, one more door), and the
// reminder is the existing SendReminderButton. The time / value mini-stats
// are the flat-fee reality check's numbers in the design's grid — the same
// null-is-not-zero contract: a job with no recorded rates shows an em dash,
// never $0 (1780's rule; a wrong dollar is worse than no dollar).

import { getTranslations } from "next-intl/server";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/time/duration";
import type { PaymentRequestStatus } from "@/lib/db/payment-requests";
import { RailBox } from "@/components/engagements/engagement-rail-box";
import { cn } from "@/lib/cn";

export async function EngagementBillingBox({
  locale,
  invoice,
  viewInvoice,
  remind,
  canceledChip,
  time,
  style,
}: {
  locale: AppLocale;
  invoice: {
    status: PaymentRequestStatus;
    amountCents: number;
    number: string | null;
    requestedAt: string | null;
    paidAt: string | null;
  } | null;
  /** The InvoiceOptionsDialog behind a "View invoice →" trigger (or null). */
  viewInvoice: React.ReactNode;
  /** SendReminderButton while unpaid (or null). */
  remind: React.ReactNode;
  /** The transient "payment canceled" chip (or null). */
  canceledChip: React.ReactNode;
  time: {
    minutes: number;
    valueCents: number | null;
  } | null;
  style?: React.CSSProperties;
}) {
  const t = await getTranslations("Engagements");

  const statusKey =
    invoice == null
      ? null
      : invoice.status === "paid"
        ? "payment_status_paid"
        : invoice.status === "failed"
          ? "payment_status_failed"
          : invoice.status === "canceled"
            ? "payment_status_canceled"
            : "payment_status_requested";

  const refLine =
    invoice == null
      ? null
      : [
          invoice.number,
          invoice.status === "paid" && invoice.paidAt
            ? t("billing_paid_on", {
                date: formatDate(invoice.paidAt, locale, "compact"),
              })
            : invoice.requestedAt
              ? t("billing_requested_on", {
                  date: formatDate(invoice.requestedAt, locale, "compact"),
                })
              : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <RailBox
      title={t("box_billing")}
      corner={viewInvoice}
      className="animate-card-in"
      style={style}
    >
      {invoice ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
              {formatCurrency(invoice.amountCents / 100, locale)}
            </span>
            {statusKey && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
                  invoice.status === "paid" &&
                    "bg-success/[0.12] text-success",
                  invoice.status === "requested" &&
                    "bg-warning/[0.13] text-warning",
                  invoice.status === "failed" &&
                    "bg-destructive/10 text-destructive",
                  invoice.status === "canceled" &&
                    "bg-secondary text-muted-foreground",
                )}
              >
                {t(statusKey)}
              </span>
            )}
          </div>
          {refLine && (
            <p className="mt-[3px] text-xs text-muted-foreground">{refLine}</p>
          )}
          {canceledChip && <div className="mt-2">{canceledChip}</div>}
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {t("billing_none_yet")}
        </p>
      )}

      {time && (
        <>
          <div aria-hidden className="my-3 h-px bg-border/60" />
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                {t("billing_time_logged")}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatMinutes(time.minutes)}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                {t("billing_value")}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {time.valueCents != null
                  ? formatCurrency(time.valueCents / 100, locale)
                  : "—"}
              </div>
            </div>
          </div>
        </>
      )}

      {remind && <div className="mt-3">{remind}</div>}
    </RailBox>
  );
}
