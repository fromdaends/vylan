"use client";

// "Portal access" — the firm's control for one client's portal access code.
//
// The code itself is NOT a prop. The page never puts it in its HTML; the eye,
// the copy button and Regenerate each fetch it through a server action that
// audit-logs the read. That is why revealing is async and can briefly show a
// spinner-less pause: the trace is the point.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  regeneratePortalPinAction,
  revealPortalPinAction,
  setPortalPinEnabledAction,
} from "@/app/actions/portal-pin";

export function ClientPortalPinCard({
  clientId,
  initialEnabled,
}: {
  clientId: string;
  initialEnabled: boolean;
}) {
  const t = useTranslations("Clients");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pin, setPin] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function explain(error: "no_session" | "unavailable" | "failed") {
    toast.error(
      error === "unavailable" ? t("portal_pin_unavailable") : t("portal_pin_error"),
    );
  }

  function onToggle(next: boolean) {
    // Optimistic, then reconciled — a toggle that lags feels broken.
    setEnabled(next);
    setPin(null);
    setShown(false);
    startTransition(async () => {
      const res = await setPortalPinEnabledAction(clientId, next);
      if (!res.ok) {
        setEnabled(!next);
        explain(res.error);
      }
    });
  }

  /** Fetch the plaintext if we don't already hold it. Every call is logged. */
  async function ensurePin(): Promise<string | null> {
    if (pin) return pin;
    const res = await revealPortalPinAction(clientId);
    if (!res.ok || !res.pin) {
      explain(res.ok ? "failed" : res.error);
      return null;
    }
    setPin(res.pin);
    return res.pin;
  }

  function onToggleVisibility() {
    if (shown) {
      setShown(false);
      return;
    }
    startTransition(async () => {
      if (await ensurePin()) setShown(true);
    });
  }

  function onCopy() {
    startTransition(async () => {
      const value = await ensurePin();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        toast.error(t("portal_pin_error"));
      }
    });
  }

  function onRegenerate() {
    startTransition(async () => {
      const res = await regeneratePortalPinAction(clientId);
      setConfirmOpen(false);
      if (!res.ok || !res.pin) {
        explain(res.ok ? "failed" : res.error);
        return;
      }
      // Show the new one straight away — the whole reason to regenerate is to
      // read a fresh code to the client, and making them click the eye again
      // to see what they just created is pure friction.
      setPin(res.pin);
      setShown(true);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <label
          htmlFor="portal-pin-toggle"
          className="text-sm leading-snug text-foreground"
        >
          {t("portal_pin_toggle")}
        </label>
        <Switch
          id="portal-pin-toggle"
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={pending}
          ariaLabel={t("portal_pin_toggle")}
        />
      </div>

      {enabled ? (
        <>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 font-mono text-base tracking-[0.3em] tabular-nums text-foreground"
              aria-live="polite"
            >
              {shown && pin ? pin : "••••••"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleVisibility}
              disabled={pending}
              aria-label={shown ? t("portal_pin_hide") : t("portal_pin_show")}
              title={shown ? t("portal_pin_hide") : t("portal_pin_show")}
            >
              {shown ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCopy}
              disabled={pending}
              aria-label={copied ? t("portal_pin_copied") : t("portal_pin_copy")}
              title={copied ? t("portal_pin_copied") : t("portal_pin_copy")}
            >
              {copied ? (
                <Check className="size-4 text-emerald-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
              aria-label={t("portal_pin_regenerate")}
              title={t("portal_pin_regenerate")}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("portal_pin_hint")}
          </p>
        </>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("portal_pin_off")}
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("portal_pin_regen_title")}</DialogTitle>
            <DialogDescription>{t("portal_pin_regen_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {t("portal_pin_cancel")}
            </Button>
            <Button type="button" onClick={onRegenerate} disabled={pending}>
              {t("portal_pin_regen_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
