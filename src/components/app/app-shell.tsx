"use client";

import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
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
  CreditCard,
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
  billing: string;
  settings: string;
  logout: string;
  profile: string;
  help: string;
};

export function AppShell({
  children,
  firmName,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  labels,
}: {
  children: React.ReactNode;
  firmName: string;
  brandColor: string;
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
    { href: "/billing", label: labels.billing, icon: CreditCard },
  ];

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
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
            <ThemeToggle />

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
                {/* Firm context (read-only label so the user knows which firm
                    they're acting on; matches the previous dropdown). */}
                <DropdownMenuLabel className="font-normal">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {brand.name}
                  </div>
                  <div className="text-xs truncate">{firmName}</div>
                </DropdownMenuLabel>
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
