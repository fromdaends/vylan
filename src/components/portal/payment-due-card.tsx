"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  CreditCard,
  AlertCircle,
  FileText,
  Download,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  parseStoredLineItems,
  parseStoredTaxLines,
} from "@/lib/invoices/totals";
import {
  lineDescriptionForDisplay,
  taxLineLabel,
} from "@/lib/invoices/pdf-model";
import {
  PortalPayPalButton,
  type PortalPayPalConfig,
} from "./portal-paypal-button";

type PaymentRequest = {
  id: string;
  amount_cents: number;
  currency: string;
  description: string | null;
  attachment_id?: string | null;
  attachment_filename?: string | null;
  attachment_mime_type?: string | null;
  status: "requested" | "paid" | "failed" | "canceled";
  // Native-invoice detail (0750): present on generated invoices, which render
  // the full document; legacy + attached rows leave these null and keep the
  // simple card exactly as before.
  invoice_kind?: "generated" | "attached" | null;
  invoice_number?: string | null;
  line_items?: unknown;
  tax_breakdown?: unknown;
  subtotal_cents?: number | null;
  tax_total_cents?: number | null;
  due_date?: string | null;
  invoice_terms?: string | null;
  invoice_language?: "en" | "fr" | null;
};

// The line-by-line invoice body for a GENERATED invoice: items, subtotal, one
// labelled line per tax (registration number underneath), total, terms. The
// UI labels follow the portal's locale; the stored line text is literal.
function InvoiceDetail({
  paymentRequest,
  locale,
  t,
}: {
  paymentRequest: PaymentRequest;
  locale: "fr" | "en";
  t: (k: string, v?: Record<string, string>) => string;
}) {
  const lines = parseStoredLineItems(paymentRequest.line_items);
  const taxLines = parseStoredTaxLines(paymentRequest.tax_breakdown);
  if (lines.length === 0) return null;
  const docLanguage = paymentRequest.invoice_language === "en" ? "en" : "fr";
  const subtotal =
    paymentRequest.subtotal_cents ??
    lines.reduce((a, l) => a + l.amount_cents, 0);
  return (
    <div className="mt-4 rounded-lg border border-border/60 text-sm">
      <ul className="divide-y divide-border/40">
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-3.5 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate">
                {lineDescriptionForDisplay(line.description, docLanguage)}
              </span>
              {line.quantity !== 1 && (
                <span className="block text-xs text-muted-foreground">
                  {line.quantity} × {formatCurrency(line.unit_cents / 100, locale)}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatCurrency(line.amount_cents / 100, locale)}
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t border-border/60 px-3.5 py-2.5">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{t("pay_subtotal")}</span>
          <span className="tabular-nums">
            {formatCurrency(subtotal / 100, locale)}
          </span>
        </div>
        {taxLines.map((line) => (
          <div
            key={line.component}
            className="flex items-start justify-between text-muted-foreground"
          >
            <span>
              {taxLineLabel(line, locale)}
              {line.registration_number && (
                <span className="block text-[11px]">
                  {t("pay_tax_reg", { number: line.registration_number })}
                </span>
              )}
            </span>
            <span className="tabular-nums">
              {formatCurrency(line.amount_cents / 100, locale)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border/60 pt-1.5 font-medium">
          <span>{t("pay_total")}</span>
          <span className="tabular-nums">
            {formatCurrency(paymentRequest.amount_cents / 100, locale)}
          </span>
        </div>
      </div>
      {(paymentRequest.invoice_terms || paymentRequest.due_date) && (
        <div className="border-t border-border/40 px-3.5 py-2 text-xs text-muted-foreground">
          {paymentRequest.due_date && (
            <span>
              {t("pay_due_date")}:{" "}
              {formatDate(paymentRequest.due_date, locale, "medium")}
              {paymentRequest.invoice_terms ? " · " : ""}
            </span>
          )}
          {paymentRequest.invoice_terms}
        </div>
      )}
    </div>
  );
}

// The "Download invoice (PDF)" row, shared by the due and paid states.
function InvoicePdfLink({
  paymentRequest,
  token,
  t,
  success,
}: {
  paymentRequest: PaymentRequest;
  token: string;
  t: (k: string) => string;
  success?: boolean;
}) {
  return (
    <a
      href={`/api/portal/invoices/${paymentRequest.id}/pdf?token=${encodeURIComponent(token)}&download=1`}
      className={
        "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors " +
        (success
          ? "border-success/25 hover:bg-success/[0.05]"
          : "border-border/60 hover:bg-secondary/60")
      }
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {paymentRequest.invoice_number
            ? `${paymentRequest.invoice_number}.pdf`
            : t("pay_invoice_pdf")}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <Download className="size-3.5" />
        {t("invoice_download")}
      </span>
    </a>
  );
}

// The client-facing payment card at the top of the portal. Shows a "Pay now"
// prompt when a payment is due, a thank-you once paid, or a retry on failure.
// Clicking Pay now opens Stripe-hosted checkout (the amount + accountant account
// are resolved server-side from the magic token — never trusted from here).
export function PaymentDueCard({
  token,
  paymentRequest,
  firmName,
  locale,
  justReturnedPaid,
  justReturnedProcessing = false,
  stripeReady = true,
  paypal = null,
}: {
  token: string;
  paymentRequest: PaymentRequest;
  firmName: string;
  locale: "fr" | "en";
  // true right after returning from a successful Stripe checkout (?paid=1) —
  // show the thank-you optimistically even before the webhook flips the status.
  justReturnedPaid: boolean;
  // true right after a PayPal capture came back PENDING (eCheck-style): the
  // client approved and owes nothing more, but the money isn't in yet.
  justReturnedProcessing?: boolean;
  // Which rails to offer. Defaults preserve today's Stripe-only card exactly:
  // stripeReady true + paypal null => the single "Pay now" button, unchanged.
  // paypal non-null adds the PayPal button; when both rails are on, the card
  // shows "Pay by card" + PayPal; PayPal-only (stripeReady false) shows only
  // PayPal.
  stripeReady?: boolean;
  paypal?: PortalPayPalConfig | null;
}) {
  const t = useTranslations("Portal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = paymentRequest.status === "paid" || justReturnedPaid;
  if (paymentRequest.status === "canceled") return null;

  const amount = formatCurrency(paymentRequest.amount_cents / 100, locale);
  const generated = paymentRequest.invoice_kind === "generated";

  // Turn the checkout route's reason code into a message the client can act on.
  // The old behaviour showed one generic "try again" for every failure — which
  // is wrong for the causes that retrying can never fix (the firm isn't set up
  // to accept payments, the invoice is already handled, the link is dead). Any
  // unknown/transient code (stripe_error, network) falls through to the generic
  // retryable message.
  function messageForError(code: string | undefined): string {
    switch (code) {
      case "not_accepting_payments":
      case "stripe_not_configured":
      case "account_unusable":
        // account_unusable = the firm's connected Stripe account can't be
        // charged in this environment (mode mismatch). Same client-facing
        // meaning as not_accepting_payments: online payment isn't available.
        return t("pay_error_unavailable", { firm: firmName });
      case "no_open_request":
        return t("pay_error_no_request");
      case "not_found":
      case "cancelled":
      case "expired":
      case "invalid_token":
        return t("pay_error_link", { firm: firmName });
      case "rate_limited":
        return t("pay_error_busy");
      case "stripe_error":
        // Stripe rejected the request (transient outage, or a persistent setup
        // issue like a test-vs-live account mismatch). Retry covers the former;
        // "contact {firm}" covers the latter — the client can't fix it alone.
        return t("pay_error_provider", { firm: firmName });
      default:
        return t("pay_error");
    }
  }

  async function pay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(messageForError(data?.error));
    } catch {
      setError(t("pay_error"));
    }
    setLoading(false);
  }

  // PayPal came back PENDING (eCheck-style): the client owes nothing more, but
  // the money hasn't cleared. A calm neutral state — not "paid" (the webhook
  // flips that later), not "due" (nothing more to do). Only while still unpaid.
  if (!paid && justReturnedProcessing && paymentRequest.status === "requested") {
    return (
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CreditCard className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">
              {t("pay_processing_title")}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("pay_processing_sub")}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (paid) {
    return (
      <section className="rounded-2xl border border-success/30 bg-success/[0.06] p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">
              {t("pay_received_title")}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("pay_received_sub", { firm: firmName, amount })}
            </div>
          </div>
        </div>
        {/* The paid record: the generated invoice's PDF, or the attached
            document exactly as before. */}
        {generated && (
          <InvoicePdfLink
            paymentRequest={paymentRequest}
            token={token}
            t={t}
            success
          />
        )}
        {paymentRequest.attachment_id && paymentRequest.attachment_filename && (
          <a
            href={`/api/portal/invoices/${paymentRequest.attachment_id}?token=${encodeURIComponent(token)}&download=1`}
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-success/25 px-3.5 py-2.5 text-sm transition-colors hover:bg-success/[0.05]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">
                {paymentRequest.attachment_filename}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <Download className="size-3.5" />
              {t("invoice_download")}
            </span>
          </a>
        )}
      </section>
    );
  }

  const failed = paymentRequest.status === "failed";

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-full " +
              (failed
                ? "bg-destructive/15 text-destructive"
                : "bg-accent/15 text-accent")
            }
          >
            {failed ? (
              <AlertCircle className="size-6" aria-hidden />
            ) : (
              <CreditCard className="size-6" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">
              {failed ? t("pay_failed_title") : t("pay_due_title")}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{amount}</span>
              {/* Generated: the number identifies the bill (the detail table
                  below carries the descriptions). Otherwise: as before. */}
              {generated && paymentRequest.invoice_number
                ? ` · ${paymentRequest.invoice_number}`
                : paymentRequest.description
                  ? ` · ${paymentRequest.description}`
                  : ` · ${t("pay_due_to", { firm: firmName })}`}
            </div>
          </div>
        </div>
        {/* Stripe-only (no PayPal rail): the original inline "Pay now" button,
            byte-for-byte unchanged. */}
        {!paypal && (
          <button
            type="button"
            onClick={pay}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CreditCard className="size-4" aria-hidden />
            {loading ? "…" : failed ? t("pay_try_again") : t("pay_now")}
          </button>
        )}
      </div>
      {/* PayPal rail present: a stacked action block with the method choice.
          When Stripe is also connected, the card button leads; PayPal-only firms
          show just the PayPal button. */}
      {paypal && (
        <div className="mt-4 space-y-3">
          {stripeReady && (
            <button
              type="button"
              onClick={pay}
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CreditCard className="size-4" aria-hidden />
              {loading ? "…" : failed ? t("pay_try_again") : t("pay_by_card")}
            </button>
          )}
          {stripeReady && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("pay_or")}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <PortalPayPalButton token={token} config={paypal} locale={locale} />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {/* Generated invoice: the full line-by-line detail + its PDF. */}
      {generated && (
        <>
          <InvoiceDetail
            paymentRequest={paymentRequest}
            locale={locale}
            t={t}
          />
          <InvoicePdfLink paymentRequest={paymentRequest} token={token} t={t} />
        </>
      )}
      {paymentRequest.attachment_id && paymentRequest.attachment_filename && (
        <a
          href={`/api/portal/invoices/${paymentRequest.attachment_id}?token=${encodeURIComponent(token)}&download=1`}
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3.5 py-2.5 text-sm transition-colors hover:bg-secondary/60"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {paymentRequest.attachment_filename}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <Download className="size-3.5" />
            {t("invoice_download")}
          </span>
        </a>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {/* "by Stripe" only when Stripe is the sole rail; a neutral line once
            PayPal is also on offer. */}
        {paypal ? t("pay_secured_generic") : t("pay_secured")}
      </p>
    </section>
  );
}
