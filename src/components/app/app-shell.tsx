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
  Archive,
  Building2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Folder,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  PencilLine,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserCircle,
  Users,
  Users2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarSearch, openCommandPalette } from "@/components/app/sidebar-search";
import { CommandPalette } from "@/components/app/command-palette";
import { viewHref, type EngagementView } from "@/lib/engagements/views";
import {
  isNavItemActive,
  isEngagementViewActive,
} from "@/lib/navigation/active-nav";
import {
  ActiveNavProvider,
  useActiveEngagementView,
} from "@/components/app/active-nav-context";

type Labels = {
  dashboard: string;
  clients: string;
  engagements: string;
  engagementsToggle: string;
  templates: string;
  settings: string;
  firm: string;
  logout: string;
  profile: string;
  help: string;
  sectionMain: string;
  sectionAccount: string;
  toggleMenu: string;
  collapseSidebar: string;
  expandSidebar: string;
  account: string;
  // Engagement sub-view labels, keyed by view.
  engagementViews: Record<EngagementView, string>;
};

// Sidebar badge counts for the Engagements sub-nav (ready-to-review +
// recently-deleted). Threaded from the layout via getEngagementBadges.
export type EngagementBadgeCounts = {
  ready: number;
  deleted: number;
};

// The seven Engagement sub-views, in nav order, with their icons + hrefs.
// Active is the parent destination (/engagements); the rest are sub-routes.
const ENGAGEMENT_SUBNAV: {
  view: EngagementView;
  icon: typeof Users;
}[] = [
  { view: "active", icon: Folder },
  { view: "ready", icon: ListChecks },
  { view: "drafts", icon: PencilLine },
  { view: "completed", icon: ClipboardList },
  { view: "archived", icon: Archive },
  { view: "cancelled", icon: XCircle },
  { view: "deleted", icon: Trash2 },
];

type NavItemDef = {
  href: string;
  label: string;
  icon: typeof Users;
  // A vibrant per-feature icon hue (text-icon-* utility) so the rail reads
  // colorful, not monochrome.
  color: string;
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
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  firmName,
  firmLogoUrl,
  labels,
  engagementBadges,
  isOwner = false,
}: {
  children: React.ReactNode;
  topBar?: React.ReactNode;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  firmName: string;
  firmLogoUrl: string | null;
  labels: Labels;
  engagementBadges: EngagementBadgeCounts;
  // Gates owner-only entries (billing, audit log, firm export/delete) in the
  // command palette. Defaults false so non-owners never see them.
  isOwner?: boolean;
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

  // Engagements is rendered as its own expandable section (not a plain
  // NavLink), so it's excluded from this flat list and inserted between
  // Clients and Templates in the sidebar body.
  const primaryNav: NavItemDef[] = [
    {
      href: "/dashboard",
      label: labels.dashboard,
      icon: LayoutDashboard,
      color: "text-icon-blue",
    },
    { href: "/clients", label: labels.clients, icon: Users, color: "text-icon-emerald" },
    {
      href: "/templates",
      label: labels.templates,
      icon: FileText,
      color: "text-icon-amber",
    },
  ];

  // Firm + Settings used to live in a sidebar "ACCOUNT" section; they
  // now live in the avatar dropdown menu (and the mobile sheet's
  // profile menu), so the sidebar nav is just primary destinations.

  return (
    <ActiveNavProvider>
    <div className="flex min-h-screen">
      {/* Desktop sidebar — always visible on sm+, collapses to an
          icon rail when the toggle is flipped. */}
      <aside
        className={cn(
          // Seamless dark surface (Vercel-style): the sidebar fills with the
          // same --background black as the main content. The sm:border-r (using
          // the existing --border token) is the subtle divider that keeps the
          // two zones distinguishable. backdrop-blur dropped — pointless on a
          // solid fill.
          "hidden sm:flex sm:flex-col sm:fixed sm:inset-y-0 sm:left-0 sm:border-r sm:border-border/40 sm:bg-background sm:z-30 transition-[width] duration-200 ease-out",
          collapsed ? "sm:w-16" : "sm:w-64",
        )}
        aria-label="Primary navigation"
      >
        <SidebarBody
          primaryNav={primaryNav}
          labels={labels}
          engagementBadges={engagementBadges}
          brandColor={brandColor}
          userDisplayName={userDisplayName}
          userEmail={userEmail}
          userAvatarUrl={userAvatarUrl}
          isOwner={isOwner}
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

        <main className="flex-1 mx-auto w-full max-w-[1600px] px-4 sm:px-8 pt-4 sm:pt-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8 animate-in-fade">
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
            brandColor={brandColor}
            userDisplayName={userDisplayName}
            userEmail={userEmail}
            userAvatarUrl={userAvatarUrl}
            isOwner={isOwner}
            onItemClick={() => setMobileAccountOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Global command palette — opened by the sidebar search trigger or
          Cmd/Ctrl-K. Mounted once; renders into a portal. */}
      <CommandPalette isOwner={isOwner} />
    </div>
    </ActiveNavProvider>
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
    {
      href: "/dashboard",
      label: labels.dashboard,
      icon: LayoutDashboard,
      color: "text-icon-blue",
    },
    { href: "/clients", label: labels.clients, icon: Users, color: "text-icon-emerald" },
    {
      href: "/templates",
      label: labels.templates,
      icon: FileText,
      color: "text-icon-amber",
    },
  ];

  // Centralized rule: /dashboard matches exactly (a leaf route); every other
  // section lights on its own page and any nested route beneath it.
  const isActive = (href: string) => isNavItemActive(pathname, href);

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
                className={cn("size-[22px] transition-transform", tab.color)}
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
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  isOwner,
  onItemClick,
}: {
  labels: Labels;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  isOwner: boolean;
  onItemClick: () => void;
}) {
  const tTeam = useTranslations("Team");
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
            href="/settings?tab=account"
            icon={Building2}
            label={labels.firm}
            onClick={onItemClick}
          />
          {isOwner && (
            <MobileMenuItem
              href="/settings/team"
              icon={Users2}
              label={tTeam("title")}
              onClick={onItemClick}
            />
          )}
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
  engagementBadges,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  isOwner,
  collapsed,
  onToggleCollapse,
}: {
  primaryNav: NavItemDef[];
  labels: Labels;
  engagementBadges: EngagementBadgeCounts;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  isOwner: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  const tHome = useTranslations("Home");
  const tTeam = useTranslations("Team");
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Brand row */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 px-2 pt-4 pb-3 border-b border-border/40">
          {onToggleCollapse ? (
            // M365-style: when collapsed, the logo IS the expand control.
            // The Vylan logo shows by default and cross-fades to the panel
            // icon on hover/focus; clicking expands the rail. Expanded (the
            // branch below), the logo is a plain link again and the collapse
            // toggle returns to its own spot on the right.
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={labels.expandSidebar}
              title={labels.expandSidebar}
              className="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90 motion-reduce:transition-none"
            >
              {/* Logo gently shrinks + fades as the panel icon spins in to
                  replace it. motion-reduce falls back to a plain swap. */}
              <span className="transition-all duration-300 ease-out group-hover:scale-50 group-hover:opacity-0 group-focus-visible:scale-50 group-focus-visible:opacity-0 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
                <Logo size={28} priority />
              </span>
              <PanelLeft
                className="absolute left-1/2 top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 -rotate-90 scale-50 text-foreground opacity-0 transition-all duration-300 ease-out group-hover:rotate-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:rotate-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                aria-hidden
              />
            </button>
          ) : (
            <Link
              href="/dashboard"
              title={brand.name}
              className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-secondary/40 transition-colors"
            >
              <Logo size={28} priority />
            </Link>
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

      {/* Global search — full trigger when expanded; a Search icon that
          opens the command palette when collapsed. */}
      {collapsed ? (
        <div className="px-2 pt-1 pb-2">
          <button
            type="button"
            data-command-palette-trigger
            onClick={openCommandPalette}
            className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-label={tHome("search_label")}
            aria-keyshortcuts="Meta+K Control+K"
            title={tHome("search_label")}
          >
            <Search className="size-[18px]" aria-hidden />
          </button>
        </div>
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
              color={item.color}
            />
          ))}
          {/* Engagements is an expandable section (Active / Ready / Drafts /
              Completed / Archived / Cancelled / Recently deleted) rather than a
              plain link. Inserted after the primary destinations. */}
          <EngagementsNav
            labels={labels}
            badges={engagementBadges}
            collapsed={collapsed}
          />
        </NavSection>
      </nav>

      {/* Team (owner-only) — quick access sitting just above the profile card. */}
      {isOwner && (
        <div className={cn(collapsed ? "px-2 pb-1.5" : "px-3 pb-2")}>
          <NavLink
            href="/settings/team"
            icon={Users2}
            label={tTeam("title")}
            collapsed={collapsed}
            color="text-icon-indigo"
          />
        </div>
      )}

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
            // Every item here navigates (Profile/Settings) or acts (Help/Logout),
            // so don't let Radix return focus to the trigger on close — otherwise
            // its focus-visible ring lingers on the profile button after a
            // client-side navigation (looked like the button stayed "selected").
            onCloseAutoFocus={(e) => e.preventDefault()}
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
  color,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  collapsed: boolean;
  color: string;
}) {
  const pathname = usePathname();
  const active = isNavItemActive(pathname, href);
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
            ? "bg-secondary text-foreground shadow-[inset_0_1px_0_0_var(--color-border)]"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        )}
      >
        {/* Icon keeps its vibrant hue in every state so the rail stays
            colorful; the active row reads via its tinted background. */}
        <Icon className={cn("size-4 shrink-0", color)} aria-hidden />
        {!collapsed && <span className="truncate">{label}</span>}
      </span>
    </Link>
  );
}

// Expandable "Engagements" sidebar section. The parent row links to
// /engagements (Active) and toggles the sub-view list; sub-rows deep-link to
// each view. Auto-expands when you're anywhere under /engagements. When the
// rail is collapsed to icons, it degrades to a single icon link to Active
// (the accordion needs labels, which the rail hides).
function EngagementsNav({
  labels,
  badges,
  collapsed,
}: {
  labels: Labels;
  badges: EngagementBadgeCounts;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const detailView = useActiveEngagementView();
  const onEngagements = isNavItemActive(pathname, "/engagements");
  // Open when on any engagements route; otherwise user-controlled.
  const [open, setOpen] = useState(onEngagements);
  // Re-expand if navigation lands under /engagements (e.g. via search).
  const lastOnRef = useRef(onEngagements);
  useEffect(() => {
    if (onEngagements && !lastOnRef.current) setOpen(true);
    lastOnRef.current = onEngagements;
  }, [onEngagements]);

  const badgeFor = (view: EngagementView): number | null => {
    if (view === "ready" && badges.ready > 0) return badges.ready;
    if (view === "deleted" && badges.deleted > 0) return badges.deleted;
    return null;
  };

  // Collapsed rail: a single icon link to Active (no room for the accordion).
  if (collapsed) {
    return (
      <Link
        href="/engagements"
        title={labels.engagements}
        aria-label={labels.engagements}
      >
        <span
          className={cn(
            "flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors",
            onEngagements
              ? "bg-secondary text-foreground shadow-[inset_0_1px_0_0_var(--color-border)]"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
          )}
        >
          <Folder className="size-4 shrink-0 text-icon-cyan" aria-hidden />
        </span>
      </Link>
    );
  }

  return (
    <div>
      {/* Parent row: the label links to Active; the caret toggles the list.
          Two controls in one row so clicking the name navigates while the
          chevron just expands/collapses. */}
      <div
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-colors",
          onEngagements
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Link
          href="/engagements"
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-secondary/60",
            pathname === "/engagements" &&
              "bg-secondary shadow-[inset_0_1px_0_0_var(--color-border)]",
          )}
        >
          <Folder className="size-4 shrink-0 text-icon-cyan" aria-hidden />
          <span className="truncate">{labels.engagements}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={labels.engagementsToggle}
          className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              open ? "rotate-0" : "-rotate-90",
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* Sub-views — smooth grid-rows expand. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 space-y-0.5 border-l border-border/50 pl-3 ml-4">
            {ENGAGEMENT_SUBNAV.map(({ view, icon: Icon }) => {
              const href = viewHref(view);
              const active = isEngagementViewActive(pathname, view, detailView);
              const count = badgeFor(view);
              return (
                <Link
                  key={view}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">
                    {labels.engagementViews[view]}
                  </span>
                  {count != null && (
                    <span
                      className={cn(
                        "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                        view === "deleted"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-accent/15 text-accent",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
