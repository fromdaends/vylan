"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
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
  Building2,
  ChevronUp,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Settings,
  UserCircle,
  Users,
  X,
} from "lucide-react";

type Labels = {
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
  // `storage` fires across tabs when localStorage changes elsewhere.
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
  // SSR snapshot — always start expanded; the first client render
  // matches, then useSyncExternalStore re-renders with the real
  // value if it differs. No hydration mismatch because React handles
  // the swap internally.
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
  // Optional strip rendered above the main content area. The demo
  // banner uses this so it pins to the top of the workspace (under
  // the slim mobile header / next to the sidebar on desktop).
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

  // Desktop sidebar collapse — persisted in localStorage. Reads
  // through useSyncExternalStore so React subscribes to the value
  // instead of fighting an effect-driven hydration pattern.
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
    // Manually fire the same event we listen to — `storage` only
    // fires in OTHER tabs, not the one that just wrote.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(COLLAPSED_EVENT));
    }
  };

  // Close mobile drawer on route change. We compare against a ref so
  // we only setState when the path *actually* moved — not on the
  // mount tick or on re-renders that happen for other reasons.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      setMobileOpen(false);
    }
  }, [pathname]);

  // Body scroll lock when the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const primaryNav: NavItemDef[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
  ];

  const accountNav: NavItemDef[] = [
    { href: "/firm", label: labels.firm, icon: Building2 },
    { href: "/settings", label: labels.settings, icon: Settings },
  ];

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
          accountNav={accountNav}
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

      {/* Mobile drawer — always renders the expanded body. */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="sm:hidden fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 350, damping: 35 }}
              className="sm:hidden fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-background border-r border-border/40 z-50 flex flex-col shadow-2xl"
              aria-label="Primary navigation"
            >
              <SidebarBody
                primaryNav={primaryNav}
                accountNav={accountNav}
                labels={labels}
                firmName={firmName}
                firmLogoUrl={firmLogoUrl}
                brandColor={brandColor}
                userDisplayName={userDisplayName}
                userEmail={userEmail}
                userAvatarUrl={userAvatarUrl}
                collapsed={false}
                onItemClick={() => setMobileOpen(false)}
                showClose
                onClose={() => setMobileOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content — offset matches the sidebar width on desktop. */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-screen transition-[margin-left] duration-200 ease-out",
          collapsed ? "sm:ml-16" : "sm:ml-64",
        )}
      >
        {/* Sticky top group: optional banner + (on mobile only) the
            slim header with hamburger. */}
        <div className="sticky top-0 z-20">
          {topBar}
          <div className="sm:hidden flex items-center gap-3 border-b border-border/40 bg-background/80 backdrop-blur-md px-4 py-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground hover:text-foreground active:scale-95 transition-all"
              aria-label={labels.toggleMenu}
            >
              <Menu className="size-4" aria-hidden />
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-semibold tracking-tight text-base"
            >
              <Logo size={26} priority />
              <span>{brand.name}</span>
            </Link>
          </div>
        </div>

        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-8 py-8 animate-in-fade">
          {children}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar body (shared between desktop + mobile drawer)
// ---------------------------------------------------------------------------

function SidebarBody({
  primaryNav,
  accountNav,
  labels,
  firmName,
  firmLogoUrl,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  collapsed,
  onToggleCollapse,
  onItemClick,
  showClose,
  onClose,
}: {
  primaryNav: NavItemDef[];
  accountNav: NavItemDef[];
  labels: Labels;
  firmName: string;
  firmLogoUrl: string | null;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onItemClick?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Brand row */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 px-2 pt-4 pb-3">
          <Link
            href="/dashboard"
            onClick={onItemClick}
            title={brand.name}
            className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-secondary/40 transition-colors"
          >
            <Logo size={28} priority />
          </Link>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={labels.expandSidebar}
              title={labels.expandSidebar}
            >
              <PanelLeft className="size-4" aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-4">
          <Link
            href="/dashboard"
            onClick={onItemClick}
            className="flex items-center gap-2.5 font-semibold tracking-tight text-base group min-w-0"
          >
            <Logo
              size={32}
              priority
              className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 shrink-0"
            />
            <span className="truncate">{brand.name}</span>
          </Link>
          {showClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={labels.toggleMenu}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={labels.collapseSidebar}
              title={labels.collapseSidebar}
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </button>
          ) : null}
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
              onClick={onItemClick}
            />
          ))}
        </NavSection>
        <NavSection label={labels.sectionAccount} collapsed={collapsed}>
          {accountNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              onClick={onItemClick}
            />
          ))}
        </NavSection>
      </nav>

      {/* Profile card at bottom — opens dropdown with Profile / Help /
          Logout. Settings + Firm already live in the nav above. */}
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
                onClick={onItemClick}
                className="flex items-center gap-2 cursor-pointer"
              >
                <UserCircle className="h-4 w-4" />
                {labels.profile}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                // The help sidebar listens for this event so we open
                // the Ask Vylan sheet without lifting state.
                window.dispatchEvent(new CustomEvent("vylan:open-help"));
                onItemClick?.();
              }}
            >
              <HelpCircle className="h-4 w-4" />
              {labels.help}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-[11px] uppercase tracking-wider text-muted-foreground pb-1">
              {labels.yourFirm}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link
                href="/firm"
                onClick={onItemClick}
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
  onClick,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <span
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-colors",
          collapsed
            ? "justify-center h-10 w-full"
            : "gap-2.5 px-3 py-2",
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
