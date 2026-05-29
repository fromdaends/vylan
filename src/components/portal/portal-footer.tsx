"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  // The accountant's contact address (assigned user, else firm owner).
  // Null only if neither has an email on file — a graceful fallback shows.
  email: string | null;
  // Pre-built mailto subject + body, already localized by the caller.
  subject: string;
  body: string;
};

// Portal footer help line.
//
// The old footer rendered a bare `mailto:` with NO recipient
// (`mailto:?subject=…`). That breaks two ways: on Windows / webmail there's
// usually no OS-registered mail client so clicking does nothing, and even when
// a desktop client opens (Mac Mail) the "To" field is blank because the
// address was never in the href.
//
// Fix: show the actual email address as the visible link text and add a Copy
// button, so a client on any OS / webmail can grab the address even if their
// browser ignores mailto:. The mailto stays — now WITH the recipient, subject,
// and body pre-filled — for clients that do have a mail app wired up.
export function PortalFooter({ email, subject, body }: Props) {
  const t = useTranslations("Portal");
  const [copied, setCopied] = useState(false);

  async function copyEmail() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be blocked (insecure context / denied permission).
      // No-op — the address is visible on screen, so the client can still
      // select and copy it by hand.
    }
  }

  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  return (
    <footer className="text-center text-sm text-muted-foreground pt-6 border-t border-border/60">
      {email && mailto ? (
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>{t("help_intro")}</span>
          <a
            href={mailto}
            className="text-foreground font-medium underline underline-offset-4 hover:opacity-80"
          >
            {email}
          </a>
          <button
            type="button"
            onClick={copyEmail}
            className="text-xs rounded border border-border/70 px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            {copied ? t("help_copied") : t("help_copy")}
          </button>
        </p>
      ) : (
        <p>{t("help_no_email")}</p>
      )}
      <p className="mt-4 text-xs text-muted-foreground/70 font-mono">
        {t("powered_by")} <span className="font-sans font-medium">Vylan</span>
      </p>
    </footer>
  );
}
