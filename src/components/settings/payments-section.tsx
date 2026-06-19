"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wallet, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// Owner-only "Get paid by clients" block at the top of the Payments settings
// section. Drives Stripe Connect (Standard) onboarding so the accountant can
// receive client payments directly. Status is read-only here — the Connect
// webhook writes the authoritative flags; this component only kicks off the
// hosted onboarding and reflects whatever state the server passed in.
export type ConnectStatus = {
  // Whether Stripe is configured at the platform level (STRIPE_SECRET_KEY).
  configured: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  onboardedAt: string | null;
  // True right after returning from Stripe's hosted onboarding (?connect=done),
  // so we can show a friendly "confirming" note while the webhook lands.
  justReturned: boolean;
};

export function PaymentsConnectSection({ connect }: { connect: ConnectStatus }) {
  const t = useTranslations("Settings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = connect.chargesEnabled;
  const incomplete = Boolean(connect.accountId) && !connected;

  async function startOnboarding() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/connect/onboard", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(
        data?.error === "migration_pending"
          ? t("connect_error_setup")
          : t("connect_error"),
      );
    } catch {
      setError(t("connect_error"));
    }
    setLoading(false);
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("connect_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("connect_hint")}</p>

      {!connect.configured ? (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 px-4 py-3 text-xs text-muted-foreground">
          {t("connect_unavailable")}
        </div>
      ) : connected ? (
        <div className="mt-4 max-w-xl rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {t("connect_connected_title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("connect_connected_hint")}
              </p>
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-accent hover:underline"
              >
                {t("connect_manage")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Wallet className="h-4 w-4" />
            </span>
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {incomplete
                  ? t("connect_incomplete_title")
                  : t("connect_start_title")}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {incomplete
                  ? t("connect_incomplete_hint")
                  : t("connect_start_hint")}
              </p>
              {connect.justReturned && incomplete && (
                <p className="text-xs text-muted-foreground">
                  {t("connect_confirming")}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={startOnboarding} disabled={loading}>
                  {loading
                    ? "…"
                    : incomplete
                      ? t("connect_resume_cta")
                      : t("connect_cta")}
                </Button>
                {connect.justReturned && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t("connect_refresh")}
                  </button>
                )}
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
