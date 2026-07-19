"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plug, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuickbooksLists } from "@/components/settings/quickbooks-lists";

// "Integrations" settings section. Holds the QuickBooks (Intuit) connection card
// (connect -> Intuit approval -> connected state) plus, once connected, a
// read-only view of the company's reference lists — accounts, vendors, customers,
// tax codes (Stage 2). The card is visible to any firm member, but connect/
// disconnect are owner-only (isOwner).
export type QuickbooksStatus = {
  // Whether the Intuit app keys are set at the platform level (QBO_CLIENT_ID +
  // QBO_CLIENT_SECRET).
  configured: boolean;
  connected: boolean;
  // A connection row exists but its tokens can no longer be used (refresh token
  // expired after ~100 days of disuse, access revoked at Intuit, or the stored
  // tokens can't be read). Only reconnecting fixes it — show the amber card.
  needsReconnect: boolean;
  companyName: string | null;
  realmId: string | null;
  environment: "sandbox" | "production";
  // The status flag the callback redirected back with, if any. On "done" the
  // connection was written synchronously before the redirect, so the connected
  // card already renders — no separate "confirming" state is needed (unlike
  // Stripe, whose status arrives later via webhook). "enc" = the go-live safety
  // lock refused a production connect because token encryption isn't configured.
  // "nomatch" = the per-client auto-link couldn't match the connected company to
  // a client by name (prompt the owner to name a client to match, then reconnect).
  callbackStatus: "done" | "denied" | "error" | "setup" | "enc" | "nomatch" | null;
  // The company name from a "nomatch" callback, to name it in the prompt.
  nomatchCompany: string | null;
};

export function IntegrationsSection({
  quickbooks,
  isOwner,
}: {
  quickbooks: QuickbooksStatus;
  isOwner: boolean;
}) {
  const t = useTranslations("Settings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  // Surface a message for a callback that came back unhappy.
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
          ? t("qbo_unavailable")
          : data?.error === "quickbooks_encryption_required"
            ? t("qbo_encryption_required")
            : t("qbo_connect_error"),
      );
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
      });
      if (res.ok) {
        // Re-render the section in its not-connected state.
        window.location.reload();
        return;
      }
      setDisconnectError(t("qbo_disconnect_error"));
    } catch {
      setDisconnectError(t("qbo_disconnect_error"));
    }
    setDisconnecting(false);
  }

  // The owner's disconnect affordance (small text button + inline confirm).
  // Shared by the green "Connected" card AND the amber "reconnect needed" card —
  // a DEAD connection must still be disconnectable without reconnecting first.
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

  // A short, plain-English walk-through shown before connecting so a new firm
  // knows exactly what linking does. Literal keys (not interpolated) so typed
  // messages stay checkable.
  const connectSteps = [
    t("qbo_connect_step1"),
    t("qbo_connect_step2"),
    t("qbo_connect_step3"),
    t("qbo_connect_step4"),
    t("qbo_connect_step5"),
  ];

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("qbo_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("qbo_hint")}</p>

      {/* Auto-link couldn't match the connected company to a client by name —
          prompt the owner to name a client to match, then connect again. */}
      {quickbooks.callbackStatus === "nomatch" && (
        <div className="mt-4 max-w-xl rounded-lg border border-warning/40 bg-warning/[0.06] p-4 text-xs leading-relaxed text-muted-foreground">
          {quickbooks.nomatchCompany
            ? t("qbo_nomatch_company", { company: quickbooks.nomatchCompany })
            : t("qbo_nomatch")}
        </div>
      )}

      {!quickbooks.configured ? (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 px-4 py-3 text-xs text-muted-foreground">
          {t("qbo_unavailable")}
        </div>
      ) : quickbooks.connected && quickbooks.needsReconnect ? (
        // The connection exists but is DEAD (expired/revoked): an amber card with
        // a Reconnect action instead of a false green "Connected".
        <div className="mt-4 max-w-xl rounded-lg border border-warning/40 bg-warning/[0.06] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("qbo_reconnect_title")}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {quickbooks.companyName
                  ? t("qbo_reconnect_hint_company", {
                      company: quickbooks.companyName,
                    })
                  : t("qbo_reconnect_hint")}
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
                  ? t("qbo_connected_company", {
                      company: quickbooks.companyName,
                    })
                  : t("qbo_connected_hint")}
              </p>
              {disconnectControl}
            </div>
          </div>
        </div>
        <QuickbooksLists />
        </>
      ) : (
        <div className="mt-4 max-w-xl rounded-lg border border-border/50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Plug className="h-4 w-4" />
            </span>
            <div className="space-y-3">
              <div className="text-sm font-medium">{t("qbo_connect_title")}</div>
              {/* What linking does — shown to everyone, so a new firm gets the
                  context before anyone connects. */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("qbo_connect_hint")}
              </p>
              {/* How it works — a short numbered walk-through of the flow. */}
              <div className="space-y-2 border-t border-border/50 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("qbo_connect_how_title")}
                </div>
                <ol className="space-y-2">
                  {connectSteps.map((step, i) => (
                    <li
                      key={i}
                      className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground"
                    >
                      <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {isOwner ? (
                <>
                  <div className="pt-1">
                    <Button
                      size="sm"
                      onClick={startConnect}
                      disabled={loading}
                      aria-busy={loading}
                    >
                      {loading ? "…" : t("qbo_connect_client_cta")}
                    </Button>
                  </div>
                  {(error || callbackError) && (
                    <p role="alert" className="text-xs text-destructive">
                      {error ?? callbackError}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("qbo_not_connected_staff")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
