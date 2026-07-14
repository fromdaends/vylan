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
import { formatCurrency } from "@/lib/format";

type PaymentRequest = {
  id: string;
  amount_cents: number;
  currency: string;
  description: string | null;
  attachment_id?: string | null;
  attachment_filename?: string | null;
  attachment_mime_type?: string | null;
  status: "requested" | "paid" | "failed" | "canceled";
};

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
}: {
  token: string;
  paymentRequest: PaymentRequest;
  firmName: string;
  locale: "fr" | "en";
  // true right after returning from a successful Stripe checkout (?paid=1) —
  // show the thank-you optimistically even before the webhook flips the status.
  justReturnedPaid: boolean;
}) {
  const t = useTranslations("Portal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = paymentRequest.status === "paid" || justReturnedPaid;
  if (paymentRequest.status === "canceled") return null;

  const amount = formatCurrency(paymentRequest.amount_cents / 100, locale);

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
              {paymentRequest.description
                ? ` · ${paymentRequest.description}`
                : ` · ${t("pay_due_to", { firm: firmName })}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={pay}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CreditCard className="size-4" aria-hidden />
          {loading
            ? "…"
            : failed
              ? t("pay_try_again")
              : t("pay_now")}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
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
      <p className="mt-3 text-xs text-muted-foreground">{t("pay_secured")}</p>
    </section>
  );
}
