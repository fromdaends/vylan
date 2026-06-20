"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plug, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Owner-only "Integrations" settings section. Stage 1 holds a single QuickBooks
// (Intuit) connection card that mirrors the Stripe Connect "Get paid" card:
// connect -> Intuit approval -> connected state. Status is read-only here; the
// OAuth callback writes the connection and this component reflects it.
export type QuickbooksStatus = {
  // Whether the Intuit app keys are set at the platform level (QBO_CLIENT_ID +
  // QBO_CLIENT_SECRET).
  configured: boolean;
  connected: boolean;
  companyName: string | null;
  realmId: string | null;
  environment: "sandbox" | "production";
  // True right after returning from Intuit (?qbo=done).
  justReturned: boolean;
  // The status flag the callback redirected back with, if any.
  callbackStatus: "done" | "denied" | "error" | "setup" | null;
};

export function IntegrationsSection({
  quickbooks,
}: {
  quickbooks: QuickbooksStatus;
}) {
  const t = useTranslations("Settings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface a message for a callback that came back unhappy.
  const callbackError =
    quickbooks.callbackStatus === "error"
      ? t("qbo_connect_error")
      : quickbooks.callbackStatus === "denied"
        ? t("qbo_connect_denied")
        : quickbooks.callbackStatus === "setup"
          ? t("qbo_connect_setup")
          : null;

  async function startConnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/quickbooks/connect", {
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
        data?.error === "quickbooks_not_configured"
          ? t("qbo_not_configured")
          : t("qbo_connect_error"),
      );
    } catch {
      setError(t("qbo_connect_error"));
    }
    setLoading(false);
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("qbo_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("qbo_hint")}</p>

      {!quickbooks.configured ? (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 px-4 py-3 text-xs text-muted-foreground">
          {t("qbo_unavailable")}
        </div>
      ) : quickbooks.connected ? (
        <div className="mt-4 max-w-xl rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {t("qbo_connected_title")}
                </span>
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium " +
                    (quickbooks.environment === "sandbox"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")
                  }
                >
                  {quickbooks.environment === "sandbox"
                    ? t("qbo_sandbox_badge")
                    : t("qbo_production_badge")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {quickbooks.companyName
                  ? t("qbo_connected_company", {
                      company: quickbooks.companyName,
                    })
                  : t("qbo_connected_hint")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Plug className="h-4 w-4" />
            </span>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("qbo_connect_title")}</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("qbo_connect_hint")}
              </p>
              <div className="pt-1">
                <Button size="sm" onClick={startConnect} disabled={loading}>
                  {loading ? "…" : t("qbo_connect_cta")}
                </Button>
              </div>
              {(error || callbackError) && (
                <p className="text-xs text-destructive">
                  {error ?? callbackError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
