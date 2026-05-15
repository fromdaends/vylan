"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  CreditCard,
  HelpCircle,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { brand } from "@/lib/brand";

// Shared sticky glassmorphism nav for all public (unauthenticated)
// pages: /, /pricing, /pricing/[plan], /faq, /terms, /privacy.
//
// Design:
//   - Sticky to the top of the viewport (`sticky top-0`) — content
//     scrolls beneath it, the bar itself never moves.
//   - Glass effect: `bg-background/70` (translucent tint that flips
//     automatically between light/dark via the CSS variable) +
//     `.glass-nav` utility (defined in globals.css) which adds the
//     `backdrop-filter: blur(16px) saturate(180%)` with a -webkit-
//     prefixed fallback for older Safari.
//   - Subtle bottom hairline + soft drop shadow so the bar reads as
//     a discrete surface, not just a transparent strip.
//   - Fixed height (h-16) so the bar never reflows on scroll.
//
// Active route is indicated with a soft pill background tint — no
// underline, no color shift, matches the calm "ghost button" feel of
// the rest of the site.
//
// Mobile (<md / <768px): primary nav links collapse into a hamburger
// menu. The mobile panel inherits the same glass-nav styling so the
// blur effect is consistent between expanded/collapsed states.

const NAV_ITEMS = [
  { href: "/pricing", labelKey: "nav_pricing", icon: CreditCard },
  { href: "/faq", labelKey: "nav_faq", icon: HelpCircle },
] as const;

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
    <header
      className={
        "sticky top-0 z-50 glass-nav bg-background/70 " +
        "border-b border-border/50 " +
        "shadow-[0_4px_24px_-12px_oklch(0.18_0.018_264/0.08)] " +
        "dark:shadow-[0_4px_24px_-12px_oklch(0_0_0/0.4)]"
      }
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 sm:px-6 h-16">
        {/* Logo + wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-base shrink-0"
          aria-label={brand.name}
          onClick={closeMobile}
        >
          <Logo size={28} priority />
          <span>{brand.name}</span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              active={isActive(href)}
              label={t(labelKey)}
              icon={<Icon className="h-3.5 w-3.5" aria-hidden />}
            />
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Locale toggle — desktop only */}
          <Link href={pathname} locale={otherLocale} className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">{otherLocale.toUpperCase()}</Button>
          </Link>
          {/* Theme toggle — desktop only */}
          <span className="hidden md:inline-flex mx-0.5">
            <ThemeToggle />
          </span>
          {/* Sign in — desktop only */}
          <Link href="/login" className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">{tAuth("sign_in")}</Button>
          </Link>
          {/* Create account — visible at all sizes (primary CTA) */}
          <Link href="/signup">
            <Button size="sm">
              {tAuth("create_account")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </Link>
          {/* Hamburger — mobile only */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className={
              "md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md " +
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

      {/* Mobile panel. Inherits the glass-nav styling so the blur
          carries across the dropdown. */}
      {mobileOpen && (
        <div
          id="public-nav-mobile"
          className="md:hidden border-t border-border/50 glass-nav bg-background/85"
        >
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
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
            <Link
              href="/login"
              onClick={closeMobile}
              className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            >
              {tAuth("sign_in")}
            </Link>
            <div className="my-1 h-px bg-border/50" />
            <div className="flex items-center justify-between px-3 py-2">
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

function NavLink({
  href,
  active,
  label,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
        (active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/5")
      }
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </Link>
  );
}
