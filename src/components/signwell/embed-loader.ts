"use client";

// Shared loader for SignWell's embedded.js — used by BOTH the client portal
// signing card (recipient signs) and the accountant's field-placement editor
// (sender drops fields). One source of truth so the script is loaded once and
// the SignWellEmbed constructor is typed in one place.
//
// The script renders a SignWell session (signing OR field placement) in an
// iframe over our page, so everything stays inside Vylan — no redirect.

let embedScriptPromise: Promise<void> | null = null;

// Load the script once (idempotent). Resolves when window.SignWellEmbed exists.
export function loadSignWellEmbed(): Promise<void> {
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
      // Reset so a later attempt can retry a transient network failure.
      embedScriptPromise = null;
      reject(new Error("script_failed"));
    };
    document.head.appendChild(s);
  });
  return embedScriptPromise;
}

export type SignWellEmbedInstance = { open: () => void; close?: () => void };

export type SignWellEmbedCtor = new (opts: {
  url: string;
  events?: {
    completed?: (e: unknown) => void;
    declined?: (e: unknown) => void;
    closed?: (e: unknown) => void;
    error?: (e: unknown) => void;
  };
}) => SignWellEmbedInstance;

// The constructor once the script has loaded, or null if it isn't ready.
export function getSignWellEmbedCtor(): SignWellEmbedCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { SignWellEmbed?: SignWellEmbedCtor }).SignWellEmbed ??
    null
  );
}

// Open a SignWell embedded session (signing or field placement) at `url` and
// wire the lifecycle callbacks. Loads the script first if needed. Throws only if
// the script or constructor can't be obtained; per-session outcomes come through
// the callbacks. Shared by the accountant editor and the resume flow.
export async function openSignWellSession(opts: {
  url: string;
  onCompleted: () => void;
  onClosed?: () => void;
  onError?: () => void;
  onDeclined?: () => void;
}): Promise<void> {
  await loadSignWellEmbed();
  const Ctor = getSignWellEmbedCtor();
  if (!Ctor) throw new Error("no_ctor");
  const embed = new Ctor({
    url: opts.url,
    events: {
      completed: () => opts.onCompleted(),
      declined: () => opts.onDeclined?.(),
      closed: () => opts.onClosed?.(),
      error: () => opts.onError?.(),
    },
  });
  embed.open();
}
