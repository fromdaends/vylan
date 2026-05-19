"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronDown,
  UserCircle,
  HelpCircle,
} from "lucide-react";

type Labels = {
  dashboard: string;
  clients: string;
  templates: string;
  settings: string;
  logout: string;
  profile: string;
  yourFirm: string;
  help: string;
};

export function AppShell({
  children,
  topBar,
  firmName,
  brandColor,
  firmLogoUrl,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  labels,
}: {
  children: React.ReactNode;
  // Optional strip rendered flush with the top of the viewport, above
  // the sticky logo+nav row. The sticky header includes it, so it
  // scrolls with the nav as a single unit. Used for the demo banner.
  topBar?: React.ReactNode;
  firmName: string;
  brandColor: string;
  firmLogoUrl: string | null;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  labels: Labels;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav: { href: string; label: string; icon: typeof Users }[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
    // Billing was here. It's now reached through Settings (see
    // /settings page's Billing link card) so the top nav stays tight
    // — Dashboard / Clients / Templates only.
  ];

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 backdrop-blur-md bg-background/80">
        {topBar}
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
              className="flex items-center gap-2.5 font-semibold tracking-tight text-base group"
            >
              <Logo
                size={36}
                priority
                className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
              />
              <span className="hidden sm:inline">{brand.name}</span>
            </Link>
          </div>

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
            {/* Theme toggle moved to /settings — there's only one preferences
                surface now, and it lives under Settings in this dropdown. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md pl-1 pr-2 py-1 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label={userDisplayName}
                >
                  <AvatarInitials
                    src={userAvatarUrl}
                    name={userDisplayName}
                    size={28}
                    color={brandColor}
                  />
                  <span className="hidden md:inline text-sm text-muted-foreground max-w-[140px] truncate">
                    {userDisplayName}
                  </span>
                  <ChevronDown className="hidden md:inline h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-medium truncate">{userDisplayName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {userEmail}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <UserCircle className="h-4 w-4" />
                    {labels.profile}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Settings className="h-4 w-4" />
                    {labels.settings}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer"
                  onSelect={(e) => {
                    e.preventDefault();
                    // The help sidebar listens for this event (registered in
                    // HelpSidebar). Keeps the menu item triggering the same
                    // sheet without lifting state to a shared context.
                    window.dispatchEvent(new CustomEvent("relai:open-help"));
                  }}
                >
                  <HelpCircle className="h-4 w-4" />
                  {labels.help}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Firm context tile. Doubles as the entry point to /firm
                    so the firm logo + name in this tile IS the "firm
                    settings" link. The standalone "Firm" menu item (briefly
                    added above) is gone; this tile carries the navigation. */}
                <DropdownMenuLabel className="font-normal text-[11px] uppercase tracking-wider text-muted-foreground pb-1">
                  {labels.yourFirm}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link
                    href="/firm"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <AvatarInitials
                      src={firmLogoUrl}
                      name={firmName}
                      size={24}
                      color={brandColor}
                    />
                    <span className="text-xs truncate">{firmName}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={logoutAction}>
                  <DropdownMenuItem asChild>
                    <button
                      type="submit"
                      className="w-full flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      {labels.logout}
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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
              <Link
                href="/profile"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              >
                <UserCircle className="h-4 w-4" />
                {labels.profile}
              </Link>
              <Link
                href="/settings"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              >
                <Settings className="h-4 w-4" />
                {labels.settings}
              </Link>
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  {labels.logout}
                </Button>
              </form>
              <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <AvatarInitials
                  src={userAvatarUrl}
                  name={userDisplayName}
                  size={24}
                  color={brandColor}
                />
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">
                    {userDisplayName}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {firmName}
                  </div>
                </div>
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
