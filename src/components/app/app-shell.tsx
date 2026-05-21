"use client";

import { useEffect, useRef, useState } from "react";
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
};

type NavItemDef = {
  href: string;
  label: string;
  icon: typeof Users;
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
      {/* Desktop sidebar — always visible on sm+ */}
      <aside
        className="hidden sm:flex sm:flex-col sm:w-64 sm:fixed sm:inset-y-0 sm:left-0 sm:border-r sm:border-border/40 sm:bg-card/50 sm:backdrop-blur-sm sm:z-30"
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
        />
      </aside>

      {/* Mobile drawer */}
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
                onItemClick={() => setMobileOpen(false)}
                showClose
                onClose={() => setMobileOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content — offset by sidebar width on desktop */}
      <div className="flex-1 flex flex-col min-h-screen sm:ml-64">
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
  onItemClick?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Brand */}
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-4">
        <Link
          href="/dashboard"
          onClick={onItemClick}
          className="flex items-center gap-2.5 font-semibold tracking-tight text-base group"
        >
          <Logo
            size={32}
            priority
            className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
          />
          <span>{brand.name}</span>
        </Link>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-label={labels.toggleMenu}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
        <NavSection label={labels.sectionMain}>
          {primaryNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              onClick={onItemClick}
            />
          ))}
        </NavSection>
        <NavSection label={labels.sectionAccount}>
          {accountNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              onClick={onItemClick}
            />
          ))}
        </NavSection>
      </nav>

      {/* Profile card at bottom — opens dropdown with Profile / Help /
          Logout. Settings + Firm already live in the nav above. */}
      <div className="border-t border-border/40 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={userDisplayName}
            >
              <AvatarInitials
                src={userAvatarUrl}
                name={userDisplayName}
                size={36}
                color={brandColor}
              />
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
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 font-semibold px-3 pb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} onClick={onClick}>
      <span
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
        <span className="truncate">{label}</span>
      </span>
    </Link>
  );
}
