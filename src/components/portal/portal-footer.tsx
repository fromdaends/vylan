"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";

type Props = {
  // The accountant's contact address (assigned user, else firm owner).
  // Null only if neither has an email on file — a graceful fallback shows.
  email: string | null;
  // Pre-built mailto subject + body, already localized by the caller.
  subject: string;
  body: string;
};

// Portal footer "Message your accountant" line.
//
// A plain `mailto:` is unreliable: on Windows / webmail there's often no
// OS-registered mail client, so clicking does nothing (the bug the founder
// hit). So the trigger opens a small picker:
//   - Gmail / Outlook → an https:// compose URL that opens a webmail tab,
//     which works on any OS regardless of installed apps.
//   - "Email app" → mailto: for clients that do have a desktop mail client.
// The visible address + Copy button stay as a universal fallback for any
// other provider (Yahoo, Proton, a work domain, …).
export function PortalFooter({ email, subject, body }: Props) {
  const t = useTranslations("Portal");
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const enc = encodeURIComponent;
  const links = email
    ? {
        gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(email)}&su=${enc(subject)}&body=${enc(body)}`,
        outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(email)}&subject=${enc(subject)}&body=${enc(body)}`,
        mailto: `mailto:${email}?subject=${enc(subject)}&body=${enc(body)}`,
      }
    : null;

  const itemClass =
    "block rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-secondary/60 transition-colors";

  return (
    <footer className="border-t border-border/60 pt-8 text-center text-sm text-muted-foreground">
      {email && links ? (
        <div className="flex flex-col items-center gap-2.5">
          <p className="text-foreground">{t("help_intro")}</p>
          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageCircle className="size-4" aria-hidden />
              {t("help_message")}
            </button>
            {menuOpen && (
              <>
                {/* Click-outside backdrop. */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 rounded-xl border border-border/60 bg-popover p-1 shadow-lg"
                >
                  <a
                    role="menuitem"
                    href={links.gmail}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className={itemClass}
                  >
                    Gmail
                  </a>
                  <a
                    role="menuitem"
                    href={links.outlook}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className={itemClass}
                  >
                    Outlook
                  </a>
                  <a
                    role="menuitem"
                    href={links.mailto}
                    onClick={() => setMenuOpen(false)}
                    className={itemClass}
                  >
                    {t("help_email_app")}
                  </a>
                </div>
              </>
            )}
          </div>
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs">
            <span>{email}</span>
            <button
              type="button"
              onClick={copyEmail}
              className="rounded-md border border-border/70 px-1.5 py-0.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              {copied ? t("help_copied") : t("help_copy")}
            </button>
          </p>
        </div>
      ) : (
        <p>{t("help_no_email")}</p>
      )}
      <div className="mt-8 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70">
        <span>{t("powered_by")}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-vylan.png" alt="" aria-hidden className="size-4" />
        <span className="font-semibold text-muted-foreground">Vylan</span>
      </div>
    </footer>
  );
}
