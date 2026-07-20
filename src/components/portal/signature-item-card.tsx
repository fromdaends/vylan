"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, PenLine, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { RequestItem } from "@/lib/db/request-items";
import type { SignatureStatus } from "@/lib/signwell/client";
import { logPortalActivity } from "@/lib/portal/activity-log";

// Load SignWell's embedded signing script once (idempotent). Resolves when
// window.SignWellEmbed is available. The script renders the signing session in
// an iframe over our page, so the client signs INSIDE Vylan (no redirect).
let embedScriptPromise: Promise<void> | null = null;
function loadSignWellEmbed(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no_window"));
  }
  const w = window as unknown as { SignWellEmbed?: unknown };
  if (w.SignWellEmbed) return Promise.resolve();
  if (embedScriptPromise) return embedScriptPromise;
  embedScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://static.signwell.com/assets/embedded.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      embedScriptPromise = null;
      reject(new Error("script_failed"));
    };
    document.head.appendChild(s);
  });
  return embedScriptPromise;
}

type SignWellEmbedInstance = { open: () => void; close?: () => void };
type SignWellEmbedCtor = new (opts: {
  url: string;
  events?: {
    completed?: (e: unknown) => void;
    declined?: (e: unknown) => void;
    closed?: (e: unknown) => void;
    error?: (e: unknown) => void;
  };
}) => SignWellEmbedInstance;

type LocalState = "idle" | "opening" | "open" | "submitted" | "error";

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
  const router = useRouter();
  const [local, setLocal] = useState<LocalState>("idle");

  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;

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

  const busy = local === "opening" || local === "open";

  async function openSigning() {
    setLocal("opening");
    // Log the intent to sign (a deliberate client click) — the authoritative
    // "signed" event is logged separately by the SignWell webhook.
    logPortalActivity(token, "client_opened_signature", {
      name: label,
      ref: item.id,
    });
    try {
      const res = await fetch(
        `/api/portal/signwell/embed?token=${encodeURIComponent(
          token,
        )}&item_id=${encodeURIComponent(item.id)}`,
      );
      if (!res.ok) throw new Error("fetch_failed");
      const body = (await res.json()) as {
        embedded_signing_url?: string;
        status?: string;
      };
      // Already signed elsewhere, or not ready.
      if (body.status === "completed") {
        setLocal("submitted");
        router.refresh();
        return;
      }
      if (!body.embedded_signing_url) throw new Error("no_url");

      await loadSignWellEmbed();
      const Ctor = (window as unknown as { SignWellEmbed?: SignWellEmbedCtor })
        .SignWellEmbed;
      if (!Ctor) throw new Error("no_ctor");

      const embed = new Ctor({
        url: body.embedded_signing_url,
        events: {
          completed: () => {
            setLocal("submitted");
            // Let the webhook flip the authoritative status + pull the PDF;
            // refresh so the server-rendered status catches up.
            router.refresh();
          },
          declined: () => setLocal("idle"),
          closed: () =>
            setLocal((s) => (s === "submitted" ? s : "idle")),
          error: () => setLocal("error"),
        },
      });
      setLocal("open");
      embed.open();
    } catch {
      setLocal("error");
    }
  }

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
