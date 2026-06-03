"use client";

// Shared "vylan" brand + slide-down navigation menu, used on BOTH the landing
// and the manifesto pages so the two can never drift. The brand sits fixed at
// the top-centre of the viewport and OPENS ON HOVER (plus click/focus, so touch
// and keyboard still work). A short close delay bridges the few pixels of
// backdrop between the brand and the menu card, so travelling from one to the
// other doesn't snap the menu shut.

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";

export type VylanMenuStrings = {
  brand: string;
  logoAlt: string;
  menuLabel: string;
  closeLabel: string;
  defTerm: string;
  defAbbr: string;
  defText: string;
  navHome: string;
  navManifesto: string;
  navForFirms: string;
  navBookDemo: string;
  navLogin: string;
  follow: string;
};

function scrollToForm() {
  document
    .getElementById("vy-get-access")
    ?.scrollIntoView({ behavior: "smooth" });
}

export function VylanMenu({ s }: { s: VylanMenuStrings }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  // ~quarter second grace so the cursor can cross from the brand to the card
  // (a sliver of backdrop in between) without the menu reading it as "left".
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 260);
  };
  const closeNow = () => {
    cancelClose();
    setOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Close, then jump to the lead form (used by the "for firms" / "book a demo"
  // items). A stable handler reference — not built during render — so it never
  // reads the timer ref in the render path.
  const closeAndJump = () => {
    closeNow();
    scrollToForm();
  };

  return (
    <>
      <button
        className="vy-brand"
        type="button"
        aria-label={s.menuLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onClick={() => setOpen((o) => !o)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="vy-logo" src="/vylan-logo-white.png" alt={s.logoAlt} />
        {s.brand}
      </button>

      <div
        className={"vy-overlay" + (open ? " vy-open" : "")}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeNow();
        }}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <button
          className="vy-menu-close"
          type="button"
          aria-label={s.closeLabel}
          onClick={closeNow}
        >
          ×
        </button>
        <div
          className="vy-menu-card"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <p className="vy-menu-def">
            <b>{s.defTerm}</b> <span className="vy-mono">{s.defAbbr}</span>
            &nbsp;{s.defText}
          </p>
          <nav className="vy-menu-nav">
            <Link href="/" onClick={closeNow}>
              {s.navHome} <span className="vy-arr">→</span>
            </Link>
            <Link href="/manifesto" onClick={closeNow}>
              {s.navManifesto} <span className="vy-arr">→</span>
            </Link>
            <a href="#vy-get-access" onClick={closeAndJump}>
              {s.navForFirms} <span className="vy-arr">→</span>
            </a>
            <a href="#vy-get-access" onClick={closeAndJump}>
              {s.navBookDemo} <span className="vy-arr">→</span>
            </a>
            <Link href="/login" onClick={closeNow}>
              {s.navLogin} <span className="vy-arr">→</span>
            </Link>
          </nav>
          <div className="vy-menu-follow">
            {s.follow}
            <span className="vy-soc">in</span>
            <span className="vy-soc">𝕏</span>
            <span className="vy-soc">◎</span>
          </div>
        </div>
      </div>
    </>
  );
}
