"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { QuickbooksLists } from "@/components/settings/quickbooks-lists";

// "Integrations" settings section. QuickBooks now connects PER CLIENT (from each
// client's own page), so this section is NO LONGER a connect entry point — it just
// explains where to connect and, if a legacy firm-wide connection still exists,
// lets an owner see + disconnect it. Visible to any firm member; disconnect is
// owner-only.
export type QuickbooksStatus = {
  // Whether the Intuit app keys are set at the platform level.
  configured: boolean;
  // A LEGACY firm-wide connection (client_id NULL). New connections are per client.
  connected: boolean;
  needsReconnect: boolean;
  companyName: string | null;
  realmId: string | null;
  environment: "sandbox" | "production";
  // Status flag from an OAuth callback that fell back to Settings (edge cases:
  // an error/denied/enc, or a connect started without a client). Per-client
  // connects land back on the client's page, not here.
  callbackStatus: "done" | "denied" | "error" | "setup" | "enc" | null;
};

export function IntegrationsSection({
  quickbooks,
  isOwner,
}: {
  quickbooks: QuickbooksStatus;
  isOwner: boolean;
}) {
  const t = useTranslations("Settings");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  // Surface a message for a callback that came back unhappy (edge-case fallbacks).
  const callbackError =
    quickbooks.callbackStatus === "error"
      ? t("qbo_connect_error")
      : quickbooks.callbackStatus === "denied"
        ? t("qbo_connect_denied")
        : quickbooks.callbackStatus === "setup"
          ? t("qbo_connect_setup")
          : quickbooks.callbackStatus === "enc"
            ? t("qbo_encryption_required")
            : null;

  async function doDisconnect() {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const res = await fetch("/api/integrations/quickbooks/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setDisconnectError(t("qbo_disconnect_error"));
    } catch {
      setDisconnectError(t("qbo_disconnect_error"));
    }
    setDisconnecting(false);
  }

  // Owner disconnect affordance (small text button + inline confirm), shared by
  // the connected + reconnect-needed cards.
  const disconnectControl = isOwner ? (
    <div className="pt-1">
      {confirmingDisconnect ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("qbo_disconnect_confirm_q")}
          </span>
          <button
            type="button"
            onClick={doDisconnect}
            disabled={disconnecting}
            aria-busy={disconnecting}
            className="text-xs font-medium text-destructive hover:underline disabled:opacity-60"
          >
            {disconnecting ? "…" : t("qbo_disconnect_confirm_yes")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDisconnect(false)}
            disabled={disconnecting}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {t("qbo_disconnect_cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDisconnect(true)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("qbo_disconnect_cta")}
        </button>
      )}
      {disconnectError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {disconnectError}
        </p>
      )}
    </div>
  ) : null;

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("qbo_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("qbo_hint")}</p>

      {callbackError && (
        <div
          role="alert"
          className="mt-4 max-w-xl rounded-lg border border-warning/40 bg-warning/[0.06] p-4 text-xs text-warning"
        >
          {callbackError}
        </div>
      )}

      {!quickbooks.configured ? (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 px-4 py-3 text-xs text-muted-foreground">
          {t("qbo_unavailable")}
        </div>
      ) : quickbooks.connected && quickbooks.needsReconnect ? (
        // A LEGACY firm-wide connection that went dead. Connecting is now per
        // client, so there's no reconnect button here — the owner disconnects it,
        // then connects clients from their pages.
        <div className="mt-4 max-w-xl rounded-lg border border-warning/40 bg-warning/[0.06] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("qbo_reconnect_title")}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("qbo_connect_per_client_note")}
              </p>
              {disconnectControl}
            </div>
          </div>
        </div>
      ) : quickbooks.connected ? (
        <>
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
                    ? t("qbo_connected_company", { company: quickbooks.companyName })
                    : t("qbo_connected_hint")}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("qbo_connect_per_client_note")}
                </p>
                {disconnectControl}
              </div>
            </div>
          </div>
          <QuickbooksLists />
        </>
      ) : (
        // Not connected → connecting happens per client, on each client's page.
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 p-4 text-xs leading-relaxed text-muted-foreground">
          {t("qbo_connect_per_client_note")}
        </div>
      )}
    </section>
  );
}
