"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CreditCard, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type PaymentRequest = {
  id: string;
  amount_cents: number;
  currency: string;
  description: string | null;
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
        | { url?: string }
        | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(t("pay_error"));
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
      <p className="mt-3 text-xs text-muted-foreground">{t("pay_secured")}</p>
    </section>
  );
}
