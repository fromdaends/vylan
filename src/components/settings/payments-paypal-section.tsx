"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wallet, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// The PayPal provider card in Settings -> Payments, rendered directly under the
// Stripe card inside the same "Get paid by clients" section and sharing its
// exact anatomy (icon box, states, emerald success, inline-confirm disconnect).
// Status is read-only here — the callback + status sync write the authoritative
// flags; this component only kicks off PayPal's hosted onboarding and reflects
// whatever state the server passed in.
//
// Renders NOTHING when PayPal isn't configured at the platform level: unlike
// Stripe (the founding rail, whose card explains itself even unconfigured), an
// absent second rail should simply not exist in the UI.
export type PayPalStatus = {
  // Whether PayPal is configured at the platform level (PAYPAL_CLIENT_ID/SECRET).
  configured: boolean;
  merchantId: string | null;
  paymentsReceivable: boolean;
  emailConfirmed: boolean;
  // Which PayPal environment this server runs against; sandbox shows a badge so
  // a test connection can never be mistaken for a live one.
  environment: "sandbox" | "live";
  // ?paypal=<status> set by the onboarding callback redirect.
  callbackStatus:
    | "done"
    | "pending"
    | "partnerid"
    | "linked"
    | "clobber"
    | "error"
    | null;
};

export function PayPalConnectSection({ paypal }: { paypal: PayPalStatus }) {
  const t = useTranslations("Settings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!paypal.configured) return null;

  const connected =
    Boolean(paypal.merchantId) &&
    paypal.paymentsReceivable &&
    paypal.emailConfirmed;
  const incomplete = Boolean(paypal.merchantId) && !connected;
  const justReturned =
    paypal.callbackStatus === "done" || paypal.callbackStatus === "pending";

  // The callback's non-success outcomes, translated for the owner. "pending"
  // isn't an error (the incomplete card explains it); "done" needs no note.
  const callbackError =
    paypal.callbackStatus === "partnerid"
      ? t("paypal_error_partnerid")
      : paypal.callbackStatus === "linked"
        ? t("paypal_error_linked")
        : paypal.callbackStatus === "clobber"
          ? t("paypal_error_clobber")
          : paypal.callbackStatus === "error"
            ? t("paypal_error")
            : null;

  const manageUrl =
    paypal.environment === "live"
      ? "https://www.paypal.com"
      : "https://www.sandbox.paypal.com";

  async function startOnboarding() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/paypal/onboard", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(
        data?.error === "not_authorized"
          ? t("paypal_error_partner_pending")
          : t("paypal_error"),
      );
    } catch {
      setError(t("paypal_error"));
    }
    setLoading(false);
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/paypal/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        // Reload so the server re-reads the now-cleared connection.
        window.location.reload();
        return;
      }
      setError(t("paypal_disconnect_error"));
    } catch {
      setError(t("paypal_disconnect_error"));
    }
    setDisconnecting(false);
    setConfirmingDisconnect(false);
  }

  // Shown whenever a connection exists (connected OR half-finished), so a stuck
  // or wrong connection can always be cleared from inside Vylan.
  const disconnectControl = paypal.merchantId ? (
    <div className="pt-1">
      {confirmingDisconnect ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {t("paypal_disconnect_confirm")}
          </span>
          <button
            type="button"
            onClick={disconnect}
            disabled={disconnecting}
            className="font-medium text-destructive hover:underline disabled:opacity-50"
          >
            {disconnecting ? "…" : t("paypal_disconnect_yes")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDisconnect(false)}
            disabled={disconnecting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {t("paypal_disconnect_cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmingDisconnect(true);
          }}
          className="text-xs font-medium text-muted-foreground hover:text-destructive hover:underline"
        >
          {t("paypal_disconnect")}
        </button>
      )}
    </div>
  ) : null;

  const sandboxBadge =
    paypal.environment === "sandbox" ? (
      <span className="inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("paypal_sandbox_badge")}
      </span>
    ) : null;

  return connected ? (
    <div className="mt-3 max-w-xl rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t("paypal_connected_title")}
            {sandboxBadge}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("paypal_connected_hint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("paypal_holds_note")}
          </p>
          <a
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-accent hover:underline"
          >
            {t("paypal_manage")}
            <ExternalLink className="h-3 w-3" />
          </a>
          {disconnectControl}
          {callbackError && (
            <p className="text-xs text-destructive">{callbackError}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  ) : (
    <div className="mt-3 max-w-xl rounded-lg border border-border/50 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <Wallet className="h-4 w-4" />
        </span>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {incomplete ? t("paypal_incomplete_title") : t("paypal_start_title")}
            {sandboxBadge}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {incomplete ? t("paypal_incomplete_hint") : t("paypal_start_hint")}
          </p>
          {justReturned && incomplete && (
            <p className="text-xs text-muted-foreground">
              {t("paypal_confirming")}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={startOnboarding} disabled={loading}>
              {loading
                ? "…"
                : incomplete
                  ? t("paypal_resume_cta")
                  : t("paypal_cta")}
            </Button>
            {justReturned && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("paypal_refresh")}
              </button>
            )}
          </div>
          {callbackError && (
            <p className="text-xs text-destructive">{callbackError}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {disconnectControl}
        </div>
      </div>
    </div>
  );
}
