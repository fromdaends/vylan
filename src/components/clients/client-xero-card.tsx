"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plug, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { XeroLogo } from "@/components/integrations/xero-logo";

// Per-client Xero card on the client detail page — the sibling of
// ClientQuickbooksCard, same states, same placement rules:
//   - Not connected + owner: a small "Connect Xero" button (connects THIS
//     client — the connect route carries this clientId).
//   - Connected: green "Connected to {organisation}" + owner disconnect. A
//     "Demo" badge when the org is Xero's resettable Demo Company (Xero has no
//     sandbox/production key split, so the org itself is the signal).
//   - Needs reconnect: amber, owner can reconnect or disconnect.
//   - Not connected + non-owner: nothing.
// The page gates the whole section (and hides Xero when the client already
// uses QuickBooks — one bookkeeping system per client).
export type ClientXeroStatus = {
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  tenantName: string | null;
  isDemo: boolean;
  callbackStatus: "done" | "denied" | "error" | "setup" | "inuse" | null;
};

export function ClientXeroCard({
  clientId,
  clientName,
  status,
  isOwner,
}: {
  clientId: string;
  clientName: string;
  status: ClientXeroStatus;
  isOwner: boolean;
}) {
  const t = useTranslations("Clients");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const callbackError =
    status.callbackStatus === "error"
      ? t("xero_connect_error")
      : status.callbackStatus === "denied"
        ? t("xero_connect_denied")
        : status.callbackStatus === "setup"
          ? t("xero_connect_setup")
          : status.callbackStatus === "inuse"
            ? t("xero_connect_inuse")
            : null;

  // Start OAuth for THIS client (first Connect and Reconnect both land here).
  async function startConnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/xero/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(
        data?.error === "xero_not_configured"
          ? t("xero_unavailable")
          : data?.error === "other_provider"
            ? t("xero_other_provider")
            : t("xero_connect_error"),
      );
    } catch {
      setError(t("xero_connect_error"));
    }
    setLoading(false);
  }

  async function doDisconnect() {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const res = await fetch("/api/integrations/xero/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setDisconnectError(t("xero_disconnect_error"));
    } catch {
      setDisconnectError(t("xero_disconnect_error"));
    }
    setDisconnecting(false);
  }

  const disconnectControl = isOwner ? (
    <div className="pt-1">
      {confirmingDisconnect ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("xero_disconnect_confirm_q", { client: clientName })}
          </span>
          <button
            type="button"
            onClick={doDisconnect}
            disabled={disconnecting}
            aria-busy={disconnecting}
            className="text-xs font-medium text-destructive hover:underline disabled:opacity-60"
          >
            {disconnecting ? "…" : t("xero_disconnect_confirm_yes")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDisconnect(false)}
            disabled={disconnecting}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {t("xero_disconnect_cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDisconnect(true)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("xero_disconnect_cta")}
        </button>
      )}
      {disconnectError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {disconnectError}
        </p>
      )}
    </div>
  ) : null;

  // Connected but DEAD: amber reconnect card.
  if (status.connected && status.needsReconnect) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/[0.06] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("xero_reconnect_title")}</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {status.tenantName
                ? t("xero_reconnect_hint_company", { company: status.tenantName })
                : t("xero_reconnect_hint", { client: clientName })}
            </p>
            {isOwner ? (
              <>
                <div className="pt-1">
                  <Button
                    size="sm"
                    onClick={startConnect}
                    disabled={loading}
                    aria-busy={loading}
                  >
                    {loading ? "…" : t("xero_reconnect_cta")}
                  </Button>
                </div>
                {(error || callbackError) && (
                  <p role="alert" className="text-xs text-destructive">
                    {error ?? callbackError}
                  </p>
                )}
                {disconnectControl}
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("xero_reconnect_staff")}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected + healthy: green card with the organisation + optional Demo badge.
  if (status.connected) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {t("xero_connected_title")}
              </span>
              {status.isDemo && (
                <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                  {t("xero_demo_badge")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {status.tenantName
                ? t("xero_connected_company", { company: status.tenantName })
                : t("xero_connected_hint")}
            </p>
            {disconnectControl}
          </div>
        </div>
      </div>
    );
  }

  // Not connected + owner: a small invitation to connect THIS client's Xero.
  if (isOwner) {
    return (
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#13B5EA]/10">
            <XeroLogo className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("xero_connect_hint", { client: clientName })}
            </p>
            <Button
              size="sm"
              onClick={startConnect}
              disabled={loading}
              aria-busy={loading}
              className="gap-1.5"
            >
              <Plug className="h-4 w-4" />
              {loading ? "…" : t("xero_connect_cta")}
            </Button>
            {(error || callbackError) && (
              <p role="alert" className="text-xs text-destructive">
                {error ?? callbackError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Not connected + non-owner → nothing.
  return null;
}
