"use client";

// The portal gate — what a client sees when their firm has switched on an
// access code. Nothing behind it is fetched until the code is right: the page
// renders THIS instead of the portal, it never renders the portal with a
// screen over it.
//
// Deliberately minimal, and deliberately without a "forgot code" link. The
// firm is the reset path — that is the whole design — so the only help offered
// is "contact {firm}".

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { submitPortalPinAction } from "@/app/actions/portal-pin";
import { cn } from "@/lib/cn";

const LENGTH = 6;

export function PortalGate({
  token,
  firmName,
  firmLogoUrl,
  initials,
  brandColor,
  lockedUntil,
}: {
  token: string;
  firmName: string;
  firmLogoUrl: string | null;
  initials: string;
  brandColor: string;
  lockedUntil: string | null;
}) {
  const t = useTranslations("Portal");
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [locked, setLocked] = useState<boolean>(() => {
    if (!lockedUntil) return false;
    return new Date(lockedUntil).getTime() > Date.now();
  });
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!locked) inputs.current[0]?.focus();
  }, [locked]);

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await submitPortalPinAction(token, code);
        if (res.ok) {
          // Full reload rather than a router refresh: the whole document is
          // replaced by the real portal, which is a different tree entirely.
          window.location.reload();
          return;
        }
        if (res.reason === "locked") {
          setLocked(true);
          return;
        }
        setError(res.reason === "wrong" ? "wrong" : "unavailable");
        if (res.reason === "wrong") {
          setAttemptsLeft(res.attemptsRemaining);
        }
        setShake(true);
        setDigits(Array(LENGTH).fill(""));
        inputs.current[0]?.focus();
        window.setTimeout(() => setShake(false), 420);
      } catch {
        setError("unavailable");
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  const write = useCallback(
    (next: string[]) => {
      setDigits(next);
      const code = next.join("");
      if (code.length === LENGTH && next.every((d) => d !== "")) {
        void submit(code);
      }
    },
    [submit],
  );

  function onChange(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (!only) {
      const next = [...digits];
      next[i] = "";
      setDigits(next);
      return;
    }
    // Typing (or autofilling) more than one digit at a time spills forward,
    // so an SMS-style paste into the middle box still lands correctly.
    const next = [...digits];
    for (let k = 0; k < only.length && i + k < LENGTH; k++) {
      next[i + k] = only[k]!;
    }
    const landed = Math.min(i + only.length, LENGTH - 1);
    inputs.current[landed]?.focus();
    write(next);
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[i]) return; // clear this box first
      e.preventDefault();
      if (i === 0) return;
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      inputs.current[i - 1]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LENGTH - 1) inputs.current[i + 1]?.focus();
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    const next = Array(LENGTH).fill("");
    for (let k = 0; k < Math.min(text.length, LENGTH); k++) next[k] = text[k]!;
    inputs.current[Math.min(text.length, LENGTH) - 1]?.focus();
    write(next);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Same near-black identity band as the portal itself, so the gate reads
          as the firm's front door rather than a Vylan interstitial. */}
      <header className="bg-[#0a0a0c]" style={{ background: "#0a0a0c" }}>
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4 sm:px-6">
          {firmLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={firmLogoUrl}
              alt={firmName}
              className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : (
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ring-1 ring-inset ring-white/[0.12]"
              style={{ background: brandColor }}
              aria-hidden
            >
              {initials}
            </div>
          )}
          <div className="truncate text-[15px] font-semibold tracking-tight text-white">
            {firmName}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-center text-lg font-semibold tracking-tight text-foreground">
          {t("gate_title", { firm: firmName })}
        </h1>

        {locked ? (
          <p
            role="status"
            className="mt-6 rounded-2xl border border-border/60 bg-card px-4 py-3 text-center text-sm text-muted-foreground"
          >
            {t("gate_locked")}
          </p>
        ) : (
          <>
            <div
              className={cn(
                "mt-8 flex justify-center gap-2",
                shake && "animate-pin-shake",
              )}
            >
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={d}
                  onChange={(e) => onChange(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={onPaste}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={busy}
                  // inputMode numeric brings up the digit keypad on phones;
                  // autocomplete one-time-code lets iOS offer the code if the
                  // client has it in a message.
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={LENGTH}
                  aria-label={t("gate_digit_label", { n: i + 1 })}
                  aria-invalid={error === "wrong"}
                  className={cn(
                    "size-12 rounded-xl border bg-card text-center text-lg font-semibold tabular-nums text-foreground shadow-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    error === "wrong" ? "border-destructive" : "border-border/60",
                  )}
                />
              ))}
            </div>

            <div aria-live="polite" className="mt-4 min-h-10 text-center">
              {error === "wrong" && (
                <p className="text-sm text-destructive">{t("gate_error_wrong")}</p>
              )}
              {error === "unavailable" && (
                <p className="text-sm text-destructive">
                  {t("gate_unavailable")}
                </p>
              )}
              {/* The count only appears once the client is genuinely close to
                  the lockout — earlier than that it reads as a threat for no
                  reason. */}
              {error === "wrong" &&
                attemptsLeft !== null &&
                attemptsLeft <= 2 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("gate_attempts_remaining", { count: attemptsLeft })}
                  </p>
                )}
              {busy && (
                <p className="text-sm text-muted-foreground">
                  {t("gate_checking")}
                </p>
              )}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("gate_help", { firm: firmName })}
        </p>
      </main>
    </div>
  );
}
