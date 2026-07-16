"use client";

// Shared "vylan" brand + slide-down navigation menu, used on BOTH the landing
// and the manifesto pages so the two can never drift. The brand sits fixed at
// the top-centre of the viewport and OPENS ON HOVER (plus click/focus, so touch
// and keyboard still work). A short close delay bridges the few pixels of
// backdrop between the brand and the menu card, so travelling from one to the
// other doesn't snap the menu shut.

import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";

export type VylanMenuStrings = {
  brand: string;
  logoAlt: string;
  menuLabel: string;
  closeLabel: string;
  defTerm: string;
  defAbbr: string;
  defText: string;
  navHome: string;
  navHowItWorks: string;
  navBookDemo: string;
  navLogin: string;
  navContact: string;
  navHelp?: string;
  follow: string;
};

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

// How far you scroll before the brand gets out of the way. Roughly "you have
// started reading" — past its own 24px offset and its 28px type, with room to
// spare so a nudge of the wheel doesn't flicker it.
const BRAND_HIDE_AFTER_PX = 90;

export function VylanMenu({
  s,
  bookDemoHref,
  helpHref,
  hideBrandOnScroll = false,
}: {
  s: VylanMenuStrings;
  // Pages that render the lead form themselves (landing, how-it-works,
  // contact) leave this off and keep the in-page smooth scroll. The help
  // center does NOT render the form — a 100vh demo pitch under every article
  // is not a help center — so it passes a fully-resolved, locale-prefixed URL
  // to the landing page's form instead. Without this the item would scroll to
  // an element that isn't on the page, i.e. do nothing.
  bookDemoHref?: string;
  // Absolute, locale-prefixed /help URL. Opens in a new tab (founder spec).
  // Omitted on pages built before the help center existed.
  helpHref?: string;
  // Fade the brand out once the reader has scrolled in.
  //
  // The brand OPENS ON HOVER and is position:fixed at the top centre. That's
  // right on the landing, where the whole page is the menu's stage. It's wrong
  // on a long reading page: the pointer drifts across the top of the screen
  // and the menu drops open over the paragraph you were reading, unasked.
  //
  // Off by default, so landing / how-it-works / contact / manifesto keep the
  // behaviour they have today. Only the help center opts in.
  hideBrandOnScroll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [brandHidden, setBrandHidden] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

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

  // Brand fades away once you've scrolled in (opt-in, see hideBrandOnScroll).
  useEffect(() => {
    if (!hideBrandOnScroll) return;
    const onScroll = () => {
      const past = window.scrollY > BRAND_HIDE_AFTER_PX;
      setBrandHidden(past);
      // An open menu whose trigger just faded out is a menu you can't
      // reasonably dismiss by leaving it. Close it with the brand.
      if (past) setOpen(false);
    };
    // Run once: a reload restores scroll position, and the brand shouldn't
    // flash in at whatever height the browser drops you back at.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hideBrandOnScroll]);

  // Close, then jump to the lead form (used by the "for firms" / "book a demo"
  // items). A stable handler reference — not built during render — so it never
  // reads the timer ref in the render path.
  const closeAndJump = () => {
    closeNow();
    scrollToId("vy-get-access");
  };

  return (
    <>
      <button
        className={"vy-brand" + (brandHidden ? " vy-brand-hidden" : "")}
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
            <Link
              href="/"
              onClick={(e) => {
                closeNow();
                // Already on the landing: scroll back to the top (which resets
                // the scroll-driven hero) instead of a dead same-route nav.
                if (pathname === "/") {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              {s.navHome} <span className="vy-arr">→</span>
            </Link>
            <Link href="/how-it-works" onClick={closeNow}>
              {s.navHowItWorks} <span className="vy-arr">→</span>
            </Link>
            {bookDemoHref ? (
              <a href={bookDemoHref} onClick={closeNow}>
                {s.navBookDemo} <span className="vy-arr">→</span>
              </a>
            ) : (
              <a href="#vy-get-access" onClick={closeAndJump}>
                {s.navBookDemo} <span className="vy-arr">→</span>
              </a>
            )}
            <Link href="/contact" onClick={closeNow}>
              {s.navContact} <span className="vy-arr">→</span>
            </Link>
            {helpHref && s.navHelp ? (
              <a
                href={helpHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeNow}
              >
                {s.navHelp} <span className="vy-arr">→</span>
              </a>
            ) : null}
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
