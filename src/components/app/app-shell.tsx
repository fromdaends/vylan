"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { logoutAction } from "@/app/actions/auth";
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";

type Labels = {
  dashboard: string;
  clients: string;
  templates: string;
  billing: string;
  settings: string;
  logout: string;
};

export function AppShell({
  children,
  firmName,
  firmInitials,
  brandColor,
  labels,
}: {
  children: React.ReactNode;
  firmName: string;
  firmInitials: string;
  brandColor: string;
  labels: Labels;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav: { href: string; label: string; icon: typeof Users }[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
    { href: "/billing", label: labels.billing, icon: CreditCard },
    { href: "/settings", label: labels.settings, icon: Settings },
  ];

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Top header */}
      <header className="sticky top-0 z-30 border-b border-border/60 backdrop-blur-md bg-background/80">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground active:scale-95 transition-all"
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-semibold tracking-tight"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background text-[10px] font-bold">
                R
              </span>
              <span className="hidden sm:inline">{brand.name}</span>
            </Link>
          </div>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    className={
                      "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                      (active
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/60")
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2.5 pr-1">
              <div
                className="size-7 rounded-full flex items-center justify-center font-medium text-white text-xs"
                style={{ backgroundColor: brandColor }}
                aria-label={firmName}
                title={firmName}
              >
                {firmInitials}
              </div>
              <span className="text-sm text-muted-foreground max-w-[140px] truncate">
                {firmName}
              </span>
            </div>
            <ThemeToggle />
            <form action={logoutAction}>
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.logout}
                title={labels.logout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <nav className="sm:hidden border-t border-border/60 px-4 py-3 animate-in-fade">
            <div className="flex flex-col gap-1">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span
                      className={
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
                        (active
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60")
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                  </Link>
                );
              })}
              <div className="border-t border-border/60 my-2" />
              <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <div
                  className="size-6 rounded-full flex items-center justify-center font-medium text-white text-[10px]"
                  style={{ backgroundColor: brandColor }}
                >
                  {firmInitials}
                </div>
                <span className="text-muted-foreground truncate">
                  {firmName}
                </span>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 animate-in-fade">
        {children}
      </main>
    </div>
  );
}
