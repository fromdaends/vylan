"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// The client's PayPal payment button, driving PayPal's v6 web SDK. Everything
// money-related is server-side: createOrder() and the capture both hit our
// routes, which set the amount from OUR invoice and the payee to the firm —
// nothing here trusts a price. This component only orchestrates the SDK and the
// two fetches, then sends the client to the paid/processing state.
//
// Kept as its own component so the SDK's script-load + custom-element lifecycle
// is isolated from the payment card, and so the card renders untouched when a
// firm has no PayPal rail.

export type PortalPayPalConfig = {
  // The accountant's PayPal merchant id (the seller we init the SDK for).
  merchantId: string;
  // Our partner client id — browser-safe per PayPal's v6 docs.
  clientId: string;
  // Our BN code; omitted from createInstance when absent (sandbox).
  partnerAttributionId: string | null;
  sdkUrl: string;
  environment: "sandbox" | "live";
};

// ── Minimal typing of the slice of the v6 SDK we touch ──────────────────────
type EligibleMethods = { isEligible: (method: string) => boolean };
type PayPalSession = {
  start: (
    opts: { presentationMode: string },
    createOrder: Promise<{ orderId: string }>,
  ) => Promise<void>;
};
type PayPalInstance = {
  findEligibleMethods: (opts: {
    currencyCode: string;
  }) => Promise<EligibleMethods>;
  createPayPalOneTimePaymentSession: (handlers: {
    onApprove: (data: { orderId: string }) => void | Promise<void>;
    onCancel?: (data: unknown) => void;
    onError?: (err: unknown) => void;
  }) => PayPalSession;
};
type PayPalSdk = {
  createInstance: (opts: Record<string, unknown>) => Promise<PayPalInstance>;
};
declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

// Load the v6 core script once per page, keyed on the URL. Concurrent callers
// share the same promise; an already-present window.paypal short-circuits.
let sdkLoadPromise: Promise<void> | null = null;
function loadPayPalSdk(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.paypal) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-paypal-v6]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("paypal sdk load failed")),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.setAttribute("data-paypal-v6", "");
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => {
      sdkLoadPromise = null; // allow a later retry
      reject(new Error("paypal sdk load failed"));
    });
    document.head.appendChild(s);
  });
  return sdkLoadPromise;
}

type ButtonState = "loading" | "ready" | "ineligible" | "processing" | "error";

export function PortalPayPalButton({
  token,
  config,
  locale,
}: {
  token: string;
  config: PortalPayPalConfig;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Portal");
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ButtonState>("loading");

  // Depend on the PRIMITIVE config fields (not the object) so a parent re-render
  // that rebuilds the config object doesn't re-run this whole setup.
  const { merchantId, clientId, partnerAttributionId, sdkUrl } = config;

  useEffect(() => {
    let cancelled = false;
    let btn: HTMLElement | null = null;
    let clickHandler: (() => void) | null = null;

    (async () => {
      try {
        await loadPayPalSdk(sdkUrl);
        if (cancelled || !window.paypal) return;

        const sdk = await window.paypal.createInstance({
          clientId,
          merchantId,
          ...(partnerAttributionId
            ? { partnerAttributionId }
            : {}),
          components: ["paypal-payments"],
          pageType: "checkout",
          locale: locale === "fr" ? "fr-CA" : "en-CA",
        });
        if (cancelled) return;

        const methods = await sdk.findEligibleMethods({ currencyCode: "CAD" });
        if (cancelled) return;
        if (!methods.isEligible("paypal")) {
          setState("ineligible");
          return;
        }

        const session = sdk.createPayPalOneTimePaymentSession({
          async onApprove(data) {
            setState("processing");
            try {
              const res = await fetch("/api/portal/paypal/capture-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, orderId: data.orderId }),
              });
              const cap = (await res.json().catch(() => null)) as {
                ok?: boolean;
                status?: string;
                error?: string;
              } | null;
              if (res.ok && cap?.status === "COMPLETED") {
                window.location.assign(`/r/${token}?paid=1`);
                return;
              }
              if (res.ok && cap?.status) {
                // PENDING (eCheck-style): money not in yet; show the processing
                // state via the portal so the client knows nothing more is owed.
                window.location.assign(`/r/${token}?paypal=processing`);
                return;
              }
              setState("error");
            } catch {
              setState("error");
            }
          },
          onCancel() {
            setState("ready");
          },
          onError() {
            setState("error");
          },
        });

        // createOrder() must resolve to { orderId } (v6 shape). Invoked at click
        // time; the amount is set server-side from our invoice.
        const createOrder = () =>
          fetch("/api/portal/paypal/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          })
            .then((r) => r.json())
            .then((d: { id?: string; error?: string }) => {
              if (!d?.id) throw new Error(d?.error ?? "create_failed");
              return { orderId: d.id };
            });

        btn = document.createElement("paypal-button");
        btn.setAttribute("type", "pay");
        containerRef.current?.appendChild(btn);
        clickHandler = () => {
          session
            .start({ presentationMode: "auto" }, createOrder())
            .catch(() => setState("error"));
        };
        btn.addEventListener("click", clickHandler);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      if (btn && clickHandler) btn.removeEventListener("click", clickHandler);
      btn?.parentElement?.removeChild(btn);
    };
  }, [token, locale, merchantId, clientId, partnerAttributionId, sdkUrl]);

  // Ineligible in this buyer's context (device/region/currency): render nothing
  // so the card path stands alone, exactly as if PayPal weren't offered.
  if (state === "ineligible") return null;

  return (
    <div>
      {state === "loading" && (
        <div className="h-11 w-full animate-pulse rounded-full bg-secondary/60" />
      )}
      {state === "processing" && (
        <p className="text-sm text-muted-foreground">{t("pay_processing")}</p>
      )}
      {/* The SDK mounts <paypal-button> here once ready. */}
      <div ref={containerRef} className={state === "ready" ? "" : "hidden"} />
      {state === "error" && (
        <p className="text-sm text-destructive">{t("pay_paypal_error")}</p>
      )}
    </div>
  );
}
