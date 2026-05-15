"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  LifeBuoy,
  Mail,
  Menu,
  MessageCircleQuestion,
  PlayCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { brand } from "@/lib/brand";

// Floating-pill glassmorphism nav for all public (unauthenticated)
// pages: /, /pricing, /pricing/[plan], /faq, /terms, /privacy.
//
// Structure:
//   <header>            ← fixed positioning shell, full width,
//                         pointer-events: none so clicks fall through
//                         on either side of the pill.
//     <div pill>        ← the actual visual pill. Rounded-full,
//                         glass blur, gloss inset, drop shadow.
//                         pointer-events: auto.
//       <div h-16>      ← flex row of nav contents.
//     <div mobile>      ← rounded-3xl panel below the pill, only
//                         rendered when the hamburger is open.
//   </header>
//
// Visual stack on the pill:
//   1. .glass-nav    → backdrop-filter: blur(24px) saturate(180%)
//                      with -webkit-backdrop-filter for Safari.
//   2. bg-background/55 → 55% translucent tint; the underlying
//                         `--background` CSS variable flips per
//                         theme so light = pale glass, dark = dark
//                         glass.
//   3. border foreground/10 → hairline that flips dark↔light:
//                             `--foreground` is dark in light mode
//                             and light in dark mode, so a single
//                             token gives correctly-tinted borders.
//   4. Outer drop shadow → diffused, makes the pill visibly float
//                          off the page.
//   5. Inset 1px top highlight → the premium gloss line at the top
//                                edge. Higher opacity in dark mode
//                                so it actually reads against a
//                                dark surface.
//
// Active route gets a soft pill background tint on the relevant nav
// item — no underline, calm "ghost button" feel.
//
// Mobile (<md): hamburger inside the pill collapses the help items
// + sign in into a floating rounded panel that sits below the pill
// with a small gap, matching the same glass styling.

const HELP_ITEMS = [
  { href: "/tutorials", labelKey: "nav_help_tutorials", icon: PlayCircle },
  { href: "/faq", labelKey: "nav_help_questions", icon: MessageCircleQuestion },
] as const;

// Pill visual. Three shadow layers:
//   - Outer drop shadow: makes the pill float off the page.
//   - Inset top highlight: the gloss line that sells "polished glass".
//   - Inset bottom shadow: a barely-there dark line at the bottom
//     edge → adds a subtle bevel so the pill reads as a 3D plate
//     instead of a flat sticker.
// Dark mode swaps to deeper outer shadow + lighter gloss (so the
// highlight pops against a dark surface) + slightly darker bottom.
//
// Interactive: a single, calm `hover:scale-[1.01]` with a 250 ms
// ease-out transition. No tilt, no spotlight — the previous version
// hammered too much. Just a subtle "expand on hover".
const PILL_CLASSES =
  "glass-nav bg-background/55 border border-foreground/10 rounded-full " +
  "transition-transform duration-300 ease-out hover:scale-[1.025] motion-reduce:transition-none motion-reduce:hover:scale-100 " +
  "shadow-[0_12px_40px_-10px_rgba(15,18,30,0.15),inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(0,0,0,0.03)] " +
  "dark:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.25)]";

export function PublicNav() {
  const t = useTranslations("Landing");
  const tAuth = useTranslations("Auth");
  const locale = useLocale() as "fr" | "en";
  const pathname = usePathname();
  const otherLocale = locale === "fr" ? "en" : "fr";
  const [mobileOpen, setMobileOpen] = useState(false);

  // next-intl's pathname excludes the /[locale] prefix, so a string
  // compare against the route href is correct.
  const isActive = (href: string) => pathname === href;

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center px-3 sm:px-6 pt-5 sm:pt-7 pointer-events-none">
      {/* The pill itself */}
      <div className={"pointer-events-auto w-full max-w-5xl " + PILL_CLASSES}>
        <div className="flex items-center justify-between gap-3 pl-3 pr-2 sm:pl-4 sm:pr-3 h-16">
          {/* Logo only — wordmark removed per design direction.
              Responsive size: 40px on mobile, 48px from md up. */}
          <Link
            href="/"
            className="flex items-center shrink-0"
            aria-label={brand.name}
            onClick={closeMobile}
          >
            <Logo size={40} priority className="md:hidden" />
            <Logo size={48} priority className="hidden md:inline-flex" />
          </Link>

          {/* Right cluster — no middle nav links; logo flushes left,
              utility + sign in flush right via justify-between. */}
          <div className="flex items-center gap-1 shrink-0">
            {/* FAQ dropdown — desktop only. Tutorials / Questions /
                Contact us. Sits in the utility cluster alongside locale
                + theme + sign in. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:inline-flex"
                  aria-label={t("nav_faq")}
                >
                  <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                  {t("nav_faq")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {HELP_ITEMS.map(({ href, labelKey, icon: Icon }) => (
                  <DropdownMenuItem key={href} asChild>
                    <Link
                      href={href}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {t(labelKey)}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem asChild>
                  <a
                    href={`mailto:${brand.supportEmail}`}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Mail className="h-4 w-4" aria-hidden />
                    {t("nav_help_contact")}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* Mobile panel — floats as a rounded sibling below the pill
          with an 8px gap (mt-2). Same glass treatment as the pill so
          they visually pair. Only rendered when the hamburger is
          open. */}
      {mobileOpen && (
        <div
          id="public-nav-mobile"
          className={
            "pointer-events-auto mt-2 w-full max-w-5xl md:hidden " +
            "glass-nav bg-background/85 " +
            "border border-foreground/10 rounded-3xl " +
            "shadow-[0_12px_36px_-12px_rgba(15,18,30,0.18)] " +
            "dark:shadow-[0_12px_36px_-12px_rgba(0,0,0,0.5)]"
          }
        >
          <div className="px-4 py-3 flex flex-col gap-1">
            <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
              {t("nav_faq")}
            </div>
            {HELP_ITEMS.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeMobile}
                  className={
                    "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium " +
                    (active
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/5")
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(labelKey)}
                </Link>
              );
            })}
            <a
              href={`mailto:${brand.supportEmail}`}
              onClick={closeMobile}
              className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            >
              <Mail className="h-4 w-4" aria-hidden />
              {t("nav_help_contact")}
            </a>
            <div className="my-2 h-px bg-border/50" />
            {/* Highlighted Sign in CTA on mobile too. */}
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
