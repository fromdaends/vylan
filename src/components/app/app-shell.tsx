"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Building2,
  ChevronUp,
  FileText,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  UserCircle,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarSearch } from "@/components/app/sidebar-search";

type Labels = {
  inbox: string;
  dashboard: string;
  clients: string;
  templates: string;
  settings: string;
  firm: string;
  logout: string;
  profile: string;
  yourFirm: string;
  help: string;
  sectionMain: string;
  sectionAccount: string;
  toggleMenu: string;
  collapseSidebar: string;
  expandSidebar: string;
  account: string;
};

type NavItemDef = {
  href: string;
  label: string;
  icon: typeof Users;
};

const COLLAPSED_KEY = "vylan:sidebar-collapsed";
const COLLAPSED_EVENT = "vylan:sidebar-collapsed-changed";

function subscribeCollapsed(callback: () => void) {
  window.addEventListener(COLLAPSED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerCollapsed(): boolean {
  return false;
}

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
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);

  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getStoredCollapsed,
    getServerCollapsed,
  );
  const setCollapsed = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(collapsed) : next;
    try {
      localStorage.setItem(COLLAPSED_KEY, String(value));
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(COLLAPSED_EVENT));
    }
  };

  // Close the mobile account sheet on route change (e.g. user tapped
  // a menu link). Ref-guarded to avoid setting state on every render.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      setMobileAccountOpen(false);
    }
  }, [pathname]);

  const primaryNav: NavItemDef[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    { href: "/inbox", label: labels.inbox, icon: Inbox },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
  ];

  // Firm + Settings used to live in a sidebar "ACCOUNT" section; they
  // now live in the avatar dropdown menu (and the mobile sheet's
  // profile menu), so the sidebar nav is just primary destinations.

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — always visible on sm+, collapses to an
          icon rail when the toggle is flipped. */}
      <aside
        className={cn(
          "hidden sm:flex sm:flex-col sm:fixed sm:inset-y-0 sm:left-0 sm:border-r sm:border-border/40 sm:bg-card/50 sm:backdrop-blur-sm sm:z-30 transition-[width] duration-200 ease-out",
          collapsed ? "sm:w-16" : "sm:w-64",
        )}
        aria-label="Primary navigation"
      >
        <SidebarBody
          primaryNav={primaryNav}
          labels={labels}
          firmName={firmName}
          firmLogoUrl={firmLogoUrl}
          brandColor={brandColor}
          userDisplayName={userDisplayName}
          userEmail={userEmail}
          userAvatarUrl={userAvatarUrl}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </aside>

      {/* Main content — offset matches the sidebar width on desktop.
          Mobile gets bottom padding to clear the tab bar. */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-screen transition-[margin-left] duration-200 ease-out",
          collapsed ? "sm:ml-16" : "sm:ml-64",
        )}
      >
        {topBar && (
          <div className="sticky top-0 z-20">
            {topBar}
          </div>
        )}

        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-8 pt-4 sm:pt-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8 animate-in-fade">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar — primary nav for mobile. Fixed bottom,
          safe-area-aware. */}
      <MobileTabBar
        labels={labels}
        userDisplayName={userDisplayName}
        userAvatarUrl={userAvatarUrl}
        brandColor={brandColor}
        onAccountClick={() => setMobileAccountOpen(true)}
      />

      {/* Mobile account sheet — slides up from the bottom when the
          Account tab is tapped. Holds the same secondary actions that
          the desktop bottom-left profile dropdown carries. */}
      <Sheet open={mobileAccountOpen} onOpenChange={setMobileAccountOpen}>
        <SheetContent
          side="bottom"
          className="sm:hidden rounded-t-3xl p-0 border-t border-border/40 max-h-[88vh] gap-0"
        >
          <MobileAccountMenu
            labels={labels}
            firmName={firmName}
            firmLogoUrl={firmLogoUrl}
            brandColor={brandColor}
            userDisplayName={userDisplayName}
            userEmail={userEmail}
            userAvatarUrl={userAvatarUrl}
            onItemClick={() => setMobileAccountOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar
// ---------------------------------------------------------------------------

function MobileTabBar({
  labels,
  userDisplayName,
  userAvatarUrl,
  brandColor,
  onAccountClick,
}: {
  labels: Labels;
  userDisplayName: string;
  userAvatarUrl: string | null;
  brandColor: string;
  onAccountClick: () => void;
}) {
  const pathname = usePathname();
  const tabs: NavItemDef[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    { href: "/inbox", label: labels.inbox, icon: Inbox },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
  ];

  function isActive(href: string) {
    // /dashboard and /inbox are leaf routes — only match on the exact path,
    // otherwise they'd also light up on any sub-route.
    if (href === "/dashboard" || href === "/inbox") return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <nav
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/40 bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label="Bottom navigation"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 min-h-[60px] px-1 pt-2 pb-1.5 active:bg-secondary/40 transition-colors relative",
              )}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b-full bg-accent"
                />
              )}
              <Icon
                className={cn(
                  "size-[22px] transition-colors",
                  active ? "text-accent" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "text-[10.5px] font-medium leading-none tracking-tight transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onAccountClick}
          className="flex flex-col items-center justify-center gap-1 flex-1 min-h-[60px] px-1 pt-2 pb-1.5 active:bg-secondary/40 transition-colors text-muted-foreground"
        >
          <div className="relative">
            <AvatarInitials
              src={userAvatarUrl}
              name={userDisplayName}
              size={24}
              color={brandColor}
            />
          </div>
          <span className="text-[10.5px] font-medium leading-none tracking-tight">
            {labels.account}
          </span>
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile account sheet (slides up from bottom tab bar)
// ---------------------------------------------------------------------------

function MobileAccountMenu({
  labels,
  firmName,
  firmLogoUrl,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  onItemClick,
}: {
  labels: Labels;
  firmName: string;
  firmLogoUrl: string | null;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  onItemClick: () => void;
}) {
  return (
    <div className="flex flex-col">
      {/* Drag handle — visual affordance for swipe-to-dismiss. */}
      <div aria-hidden className="flex justify-center pt-3 pb-1">
        <div className="h-1 w-10 rounded-full bg-border" />
      </div>

      {/* User header */}
      <div className="px-5 pt-3 pb-4 border-b border-border/40 flex items-center gap-3.5">
        <AvatarInitials
          src={userAvatarUrl}
          name={userDisplayName}
          size={48}
          color={brandColor}
        />
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base font-semibold leading-tight truncate">
            {userDisplayName}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">
            {userEmail}
          </SheetDescription>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <div className="space-y-0.5">
          <MobileMenuItem
            href="/profile"
            icon={UserCircle}
            label={labels.profile}
            onClick={onItemClick}
          />
          <MobileMenuItem
            href="/firm"
            icon={Building2}
            label={labels.firm}
            onClick={onItemClick}
          />
          <MobileMenuItem
            href="/settings"
            icon={Settings}
            label={labels.settings}
            onClick={onItemClick}
          />
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("vylan:open-help"));
              onItemClick();
            }}
            className="w-full flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-medium text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent shrink-0">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <span className="flex-1 text-left">{labels.help}</span>
          </button>
        </div>

        {/* Firm context tile — separate visual treatment to make the
            current firm feel "anchored". Same /firm destination as the
            menu item above but framed differently. */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 font-semibold px-3 pb-2">
            {labels.yourFirm}
          </div>
          <Link
            href="/firm"
            onClick={onItemClick}
            className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
          >
            <AvatarInitials
              src={firmLogoUrl}
              name={firmName}
              size={36}
              color={brandColor}
            />
            <span className="truncate flex-1">{firmName}</span>
          </Link>
        </div>
      </div>

      {/* Logout pinned at the bottom — destructive, separated. */}
      <div
        className="border-t border-border/40 p-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 rounded-2xl px-3 py-3.5 text-sm font-medium text-destructive bg-destructive/[0.06] hover:bg-destructive/10 active:bg-destructive/15 transition-colors"
          >
            <LogOut className="size-4" aria-hidden />
            {labels.logout}
          </button>
        </form>
      </div>
    </div>
  );
}

function MobileMenuItem({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-medium text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors"
    >
      <span className="inline-flex size-9 items-center justify-center rounded-xl bg-secondary/70 text-muted-foreground shrink-0">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex-1 text-left">{label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar body (icons + labels + profile card)
// ---------------------------------------------------------------------------

function SidebarBody({
  primaryNav,
  labels,
  firmName,
  firmLogoUrl,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  collapsed,
  onToggleCollapse,
}: {
  primaryNav: NavItemDef[];
  labels: Labels;
  firmName: string;
  firmLogoUrl: string | null;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  const tHome = useTranslations("Home");
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Brand row */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 px-2 pt-4 pb-3 border-b border-border/40">
          <Link
            href="/dashboard"
            title={brand.name}
            className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-secondary/40 transition-colors"
          >
            <Logo size={28} priority />
          </Link>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="group inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground shadow-sm hover:text-foreground hover:bg-secondary hover:border-border hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
              aria-label={labels.expandSidebar}
              title={labels.expandSidebar}
            >
              <PanelLeft
                className="size-[18px] group-hover:translate-x-0.5 transition-transform"
                aria-hidden
              />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 font-semibold tracking-tight text-base group min-w-0"
          >
            <Logo
              size={32}
              priority
              className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 shrink-0"
            />
            <span className="truncate">{brand.name}</span>
          </Link>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={labels.collapseSidebar}
              title={labels.collapseSidebar}
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* Global search — full input when expanded; a Search icon that
          expands the rail when collapsed. */}
      {collapsed ? (
        onToggleCollapse && (
          <div className="px-2 pt-1 pb-2">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={tHome("search_label")}
              title={tHome("search_label")}
            >
              <Search className="size-[18px]" aria-hidden />
            </button>
          </div>
        )
      ) : (
        <div className="px-3 pt-1 pb-2">
          <SidebarSearch />
        </div>
      )}

      {/* Nav */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden pb-4",
          collapsed ? "px-2 space-y-4" : "px-3 space-y-5",
        )}
      >
        <NavSection label={labels.sectionMain} collapsed={collapsed}>
          {primaryNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
            />
          ))}
        </NavSection>
      </nav>

      {/* Profile card */}
      <div
        className={cn(
          "border-t border-border/40",
          collapsed ? "p-2" : "p-3",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "group flex items-center rounded-xl hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
                collapsed
                  ? "w-full justify-center p-1.5"
                  : "w-full gap-3 px-2 py-2",
              )}
              aria-label={userDisplayName}
              title={collapsed ? userDisplayName : undefined}
            >
              <AvatarInitials
                src={userAvatarUrl}
                name={userDisplayName}
                size={collapsed ? 32 : 36}
                color={brandColor}
              />
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium leading-tight truncate">
                      {userDisplayName}
                    </div>
                    <div className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
                      {userEmail}
                    </div>
                  </div>
                  <ChevronUp
                    className="size-3.5 text-muted-foreground/70 group-hover:text-foreground transition-colors shrink-0"
                    aria-hidden
                  />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={collapsed ? "start" : "end"}
            side="top"
            sideOffset={8}
            className="w-60"
          >
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
                window.dispatchEvent(new CustomEvent("vylan:open-help"));
              }}
            >
              <HelpCircle className="h-4 w-4" />
              {labels.help}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-[11px] uppercase tracking-wider text-muted-foreground pb-1">
              {labels.yourFirm}
            </DropdownMenuLabel>
            {/* Firm tile doubles as the entry point to firm settings —
                clicking it routes to /firm (the firm-settings page).
                The avatar + firm name keep the "this is who you're
                working as" affordance from the prior sidebar layout. */}
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
                <span className="text-xs truncate flex-1">{firmName}</span>
                <Building2
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
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
  );
}

function NavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {!collapsed && (
        <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 font-semibold px-3 pb-1.5">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  collapsed,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard" || href === "/inbox"
      ? pathname === href
      : pathname.startsWith(href);
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <span
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-colors",
          collapsed ? "justify-center h-10 w-full" : "gap-2.5 px-3 py-2",
          active
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-foreground" : "text-muted-foreground",
          )}
          aria-hidden
        />
        {!collapsed && <span className="truncate">{label}</span>}
      </span>
    </Link>
  );
}
