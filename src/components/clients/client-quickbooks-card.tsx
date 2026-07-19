"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Per-client QuickBooks STATUS card, shown on the client detail page ONLY when
// this client is connected (the page gates on status.connected). Connecting
// happens centrally in Settings → Integrations and auto-links to the client by
// name — so there is NO "Connect" invitation here; this card only shows the
// already-connected states:
//   - Connected (green): company name + sandbox/production badge, owner can disconnect.
//   - Needs reconnect (amber): the connection went dead — owner can reconnect (which
//     re-authorizes THIS client's company, carrying the clientId) or disconnect.
// A non-owner sees the status but no actions.
export type ClientQuickbooksStatus = {
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  companyName: string | null;
  environment: "sandbox" | "production";
  callbackStatus: "done" | "denied" | "error" | "setup" | "enc" | null;
};

export function ClientQuickbooksCard({
  clientId,
  clientName,
  status,
  isOwner,
}: {
  clientId: string;
  clientName: string;
  status: ClientQuickbooksStatus;
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
      ? t("qbo_connect_error")
      : status.callbackStatus === "denied"
        ? t("qbo_connect_denied")
        : status.callbackStatus === "setup"
          ? t("qbo_connect_setup")
          : status.callbackStatus === "enc"
            ? t("qbo_encryption_required")
            : null;

  // Reconnect re-authorizes THIS client's QuickBooks — carry the clientId so the
  // callback relinks it explicitly (no name-match needed).
  async function reconnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/quickbooks/connect", {
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
      setError(t("qbo_connect_error"));
    } catch {
      setError(t("qbo_connect_error"));
    }
    setLoading(false);
  }

  async function doDisconnect() {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const res = await fetch("/api/integrations/quickbooks/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
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

  const disconnectControl = isOwner ? (
    <div className="pt-1">
      {confirmingDisconnect ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("qbo_disconnect_confirm_q", { client: clientName })}
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

  // Connected but DEAD: amber reconnect card.
  if (status.connected && status.needsReconnect) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/[0.06] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t("qbo_reconnect_title")}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {status.companyName
                ? t("qbo_reconnect_hint_company", { company: status.companyName })
                : t("qbo_reconnect_hint", { client: clientName })}
            </p>
            {isOwner ? (
              <>
                <div className="pt-1">
                  <Button
                    size="sm"
                    onClick={reconnect}
                    disabled={loading}
                    aria-busy={loading}
                  >
                    {loading ? "…" : t("qbo_reconnect_cta")}
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
                {t("qbo_reconnect_staff")}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected + healthy: green card showing the linked company + environment badge.
  if (status.connected) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
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
                  (status.environment === "sandbox"
                    ? "bg-warning/15 text-warning"
                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")
                }
              >
                {status.environment === "sandbox"
                  ? t("qbo_sandbox_badge")
                  : t("qbo_production_badge")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {status.companyName
                ? t("qbo_connected_company", { company: status.companyName })
                : t("qbo_connected_hint")}
            </p>
            {disconnectControl}
          </div>
        </div>
      </div>
    );
  }

  // Not connected → nothing (the page gates on connected; connecting is central).
  return null;
}
