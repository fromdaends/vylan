"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Menu, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { brand } from "@/lib/brand";

// Floating-pill nav for all public (unauthenticated) pages:
// /, /pricing, /pricing/[plan], /faq, /terms, /privacy.
//
// Structure:
//   <header>      ← fixed positioning shell, pointer-events: none so
//                   clicks fall through on either side of the pill.
//     <div pill>  ← matte-black pill. pointer-events: auto.
//     <div mobile> ← rounded panel below the pill, only rendered
//                    when the hamburger is open.
//   </header>
//
// FAQ used to live inside the pill as a dropdown ("Help" → Tutorials
// / Questions / Contact). Per founder direction the FAQ moved to a
// small text link beneath the bottom CTA on the landing page — see
// `cta_faq_link` in `src/app/[locale]/page.tsx`. The pill is now just
// logo + locale + theme + sign-in, with the mobile hamburger
// surfacing the locale/theme controls hidden on small screens.
//
// Pill visual: matte black plate (bg-neutral-900) with a `dark`
// class wrapper so every `dark:` variant inside activates regardless
// of the page's theme; border-white/10 + a single deep drop shadow
// make it float.
const PILL_CLASSES =
  "dark bg-neutral-900 border border-white/10 rounded-full " +
  "transition-transform duration-300 ease-out hover:scale-[1.025] motion-reduce:transition-none motion-reduce:hover:scale-100 " +
  "shadow-[0_14px_44px_-10px_rgba(0,0,0,0.55)]";

export function PublicNav() {
  const t = useTranslations("Landing");
  const tAuth = useTranslations("Auth");
  const locale = useLocale() as "fr" | "en";
  const pathname = usePathname();
  const otherLocale = locale === "fr" ? "en" : "fr";
  const [mobileOpen, setMobileOpen] = useState(false);

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center px-3 sm:px-6 pt-3 sm:pt-7 pointer-events-none">
      {/* The pill itself */}
      <div className={"pointer-events-auto w-full max-w-5xl " + PILL_CLASSES}>
        <div className="flex items-center justify-between gap-2 sm:gap-3 pl-3 pr-2 sm:pl-4 sm:pr-3 h-14 sm:h-16">
          {/* Logo only — wordmark removed per design direction.
              Responsive size: 40px on mobile, 56px from md up. */}
          <Link
            href="/"
            className="flex items-center shrink-0"
            aria-label={brand.name}
            onClick={closeMobile}
          >
            {/* Wrappers carry the responsive visibility — Tailwind's
                `hidden` would otherwise lose to the `inline-flex` that
                Logo applies to its own inner span. */}
            <span className="md:hidden inline-flex">
              <Logo size={40} priority />
            </span>
            <span className="hidden md:inline-flex">
              <Logo size={56} priority />
            </span>
          </Link>

          {/* Right cluster — no middle nav links; logo flushes left,
              utility + sign in flush right via justify-between. */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Locale toggle — desktop only */}
            <Link
              href={pathname}
              locale={otherLocale}
              className="hidden md:inline-flex"
            >
              <Button variant="ghost" size="sm">
                {otherLocale.toUpperCase()}
              </Button>
            </Link>
            {/* Theme toggle — desktop only */}
            <span className="hidden md:inline-flex mx-0.5">
              <ThemeToggle />
            </span>
            {/* Demo CTA — desktop only, sits just before Sign in to
                surface the no-commitment way to try the product. */}
            <Link href="/demo" className="hidden md:inline-flex">
              <Button variant="ghost" size="sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {t("nav_demo")}
              </Button>
            </Link>
            {/* Sign in — highlighted as the primary nav CTA. */}
            <Link href="/login">
              <Button size="sm">
                {tAuth("sign_in")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </Link>
            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className={
                "md:hidden inline-flex h-9 w-9 items-center justify-center rounded-full " +
                "text-muted-foreground hover:text-foreground hover:bg-foreground/5 " +
                "active:scale-95 transition-all"
              }
              aria-label={mobileOpen ? t("nav_close_menu") : t("nav_open_menu")}
              aria-expanded={mobileOpen}
              aria-controls="public-nav-mobile"
            >
              {mobileOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile panel — surfaces the locale + theme controls that
          live in the pill on desktop but are hidden on mobile. Only
          rendered when the hamburger is open. */}
      {mobileOpen && (
        <div
          id="public-nav-mobile"
          className={
            "pointer-events-auto mt-2 w-full max-w-5xl md:hidden " +
            "dark bg-neutral-900 " +
            "border border-white/10 rounded-3xl " +
            "shadow-[0_14px_44px_-12px_rgba(0,0,0,0.55)]"
          }
        >
          <div className="px-4 py-3 flex flex-col gap-1">
            {/* Demo CTA above sign in — same emphasis pattern as the
                desktop pill. */}
            <Link href="/demo" onClick={closeMobile} className="px-1">
              <Button variant="outline" size="sm" className="w-full">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {t("nav_demo")}
              </Button>
            </Link>
            {/* Highlighted Sign in CTA on mobile too, for thumb reach. */}
            <Link href="/login" onClick={closeMobile} className="px-1">
              <Button size="sm" className="w-full">
                {tAuth("sign_in")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </Link>
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <Link
                href={pathname}
                locale={otherLocale}
                onClick={closeMobile}
                className="inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              >
                {otherLocale.toUpperCase()}
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
