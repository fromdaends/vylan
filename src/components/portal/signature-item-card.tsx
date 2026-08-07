"use client";

import { useTranslations } from "next-intl";
import { Check, PenLine, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { RequestItem } from "@/lib/db/request-items";
import type { SignatureStatus } from "@/lib/signwell/client";
import { pickItemText } from "@/lib/engagements/request-item-row";
import { usePortalSigning } from "@/components/portal/use-portal-signing";

// A signature item on the client portal (Phase 3): the client signs the document
// EMBEDDED inside Vylan via SignWell. No download, no re-upload, no redirect.
// Status comes from the SignWell request: "sent"/"viewed" => the client can sign,
// "completed" => signed. The authoritative completion + signed-PDF return happens
// via the SignWell webhook (Phase 4); on the in-session "completed" event we show
// an optimistic "received" state and refresh.
export function SignatureItemCard({
  token,
  item,
  locale,
  signatureStatus,
}: {
  token: string;
  item: RequestItem;
  locale: "fr" | "en";
  signatureStatus: SignatureStatus | null;
}) {
  const t = useTranslations("Portal");
  const label = pickItemText(locale, item.label_fr, item.label);
  // Shared with the proposal screen's letter signing — one opener, never two.
  const { local, busy, openSigning } = usePortalSigning({
    token,
    itemId: item.id,
    activityLabel: label,
  });

  const isSigned = local === "submitted" || signatureStatus === "completed";
  const canSign =
    !isSigned &&
    (signatureStatus === "sent" || signatureStatus === "viewed");
  // Anything else (no request yet, setup error): not signable. Show a calm
  // "being set up" message — never an internal error to the client.
  const ds: "signed" | "to_sign" | "pending" = isSigned
    ? "signed"
    : canSign
      ? "to_sign"
      : "pending";

  return (
    <div
      className={cn(
        "group rounded-xl border p-4 transition-all duration-200 sm:p-5",
        ds === "signed"
          ? "border-success/30 bg-success/[0.04]"
          : ds === "to_sign"
            ? "border-accent/25 bg-accent/[0.03]"
            : "border-border/60 bg-card/40",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <SignStatusIcon state={ds} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-snug text-foreground">
                {label}
              </h3>
              {ds === "signed" ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-success">
                  <Check className="size-4" aria-hidden />
                  {local === "submitted" ? t("sign_submitted") : t("sign_done")}
                </p>
              ) : ds === "to_sign" ? (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("sign_instructions")}
                </p>
              ) : (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("sign_setup_pending")}
                </p>
              )}
            </div>
            <SignStatusBadge state={ds} />
          </div>

          {local === "error" && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {t("sign_error")}
            </div>
          )}

          {ds === "to_sign" && (
            <div className="mt-3.5">
              <Button onClick={openSigning} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <PenLine className="size-4" aria-hidden />
                )}
                {busy
                  ? t("sign_opening")
                  : local === "error"
                    ? t("sign_retry")
                    : t("sign_cta")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignStatusIcon({
  state,
}: {
  state: "signed" | "to_sign" | "pending";
}) {
  const ring =
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "signed") {
    return (
      <span className={cn(ring, "bg-success text-white")}>
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "to_sign") {
    return (
      <span className={cn(ring, "bg-accent/10 text-accent")}>
        <PenLine className="size-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span className={cn(ring, "bg-muted/60 text-muted-foreground")}>
      <PenLine className="size-3.5" aria-hidden />
    </span>
  );
}

function SignStatusBadge({
  state,
}: {
  state: "signed" | "to_sign" | "pending";
}) {
  const t = useTranslations("Portal");
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (state === "signed")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("sign_status_signed")}
      </span>
    );
  if (state === "to_sign")
    return (
      <span className={cn(base, "bg-accent/15 text-accent")}>
        {t("sign_status_to_sign")}
      </span>
    );
  return (
    <span className={cn(base, "bg-muted/60 text-muted-foreground")}>
      {t("sign_status_to_sign")}
    </span>
  );
}
