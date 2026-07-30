"use client";

import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/app/actions/auth";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  BookOpen,
  BookOpenCheck,
  Building2,
  FileText,
  Folder,
  FolderUp,
  Gauge,
  LayoutDashboard,
  LogOut,
  Plug,
  Settings,
  Sparkles,
  UserCircle,
  Users,
  Users2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandPalette } from "@/components/app/command-palette";
import { IconRail, type RailItem } from "@/components/app/icon-rail";
import { type EngagementView } from "@/lib/engagements/views";
import { isNavItemActive } from "@/lib/navigation/active-nav";
import { ActiveNavProvider } from "@/components/app/active-nav-context";

type Labels = {
  dashboard: string;
  clients: string;
  engagements: string;
  engagementsToggle: string;
  templates: string;
  bookkeeping: string;
  integrations: string;
  integrationsToggle: string;
  // Localized name of the "Document filing" integrations sub-item (the other
  // sub-items are brand names and need no translation).
  integrationsFiling: string;
  // Rail-sized version of the same destination ("Filing" / "Classement") — the
  // full name is two words in English and wraps badly in a 72px slot.
  filingShort: string;
  settings: string;
  firm: string;
  logout: string;
  profile: string;
  help: string;
  // The PUBLIC help center at /help. Distinct from `help` above, which opens
  // the in-app "Ask Vylan" assistant panel — the two sit side by side.
  helpCenter: string;
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

type NavItemDef = {
  href: string;
  label: string;
  icon: typeof Users;
  // A vibrant per-feature icon hue (text-icon-* utility) so the rail reads
  // colorful, not monochrome.
  color: string;
};

export function AppShell({
  children,
  topBar,
  brandColor,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  labels,
  isOwner = false,
  teamEnabled = true,
  quickbooksConnected = false,
  xeroConnected = false,
}: {
  children: React.ReactNode;
  topBar?: React.ReactNode;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  labels: Labels;
  // Gates owner-only entries (billing, audit log, firm export/delete) in the
  // command palette. Defaults false so non-owners never see them.
  isOwner?: boolean;
  // Hides team shortcuts when collaboration mode is off. The Settings account
  // card remains the intentional entry point for creating a team again.
  teamEnabled?: boolean;
  // Shows the QuickBooks Integrations sub-item + drives the Bookkeeping tab.
  quickbooksConnected?: boolean;
  // Together with quickbooksConnected, drives the top-level "Bookkeeping" tab:
  // it appears once the firm has ANY bookkeeping connection (QuickBooks OR Xero),
  // since the drafts queue is a shared surface.
  xeroConnected?: boolean;
}) {
  const pathname = usePathname();
  const tApp = useTranslations("App");
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);

  // Close the mobile account sheet on route change (e.g. user tapped
  // a menu link). Ref-guarded to avoid setting state on every render.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      setMobileAccountOpen(false);
    }
  }, [pathname]);

  // The icon rail's destinations, in order. Flat by design — Engagements and
  // Integrations are single links now, because their own pages already carry the
  // sub-navigation the old expandable sections duplicated.
  const railNav: RailItem[] = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard },
    // "Performance" is the same word in EN and FR, so it's safe to hardcode.
    { href: "/performance", label: "Performance", icon: Gauge },
    { href: "/clients", label: labels.clients, icon: Users },
    { href: "/templates", label: labels.templates, icon: FileText },
    // Short label here on purpose: "Document filing" wraps to two cramped lines
    // in a rail slot. The page itself still uses the full name.
    { href: "/integrations/filing", label: labels.filingShort, icon: FolderUp },
    { href: "/engagements", label: labels.engagements, icon: Folder },
    // Bookkeeping (the shared QuickBooks + Xero drafts queue) keeps its
    // conditional tab: the design didn't include one, but the feature exists and
    // hiding it would be a regression for a connected firm. Absent until a
    // bookkeeping connection exists, exactly as before.
    ...(quickbooksConnected || xeroConnected
      ? [
          {
            href: "/quickbooks/drafts",
            label: labels.bookkeeping,
            icon: BookOpenCheck,
          },
        ]
      : []),
    { href: "/integrations", label: labels.integrations, icon: Plug },
  ];

  // Firm + Settings live in the account dropdown (and the mobile sheet's profile
  // menu), so the rail carries primary destinations only.

  return (
    <ActiveNavProvider>
    <div className="flex min-h-screen">
      {/* Desktop navigation — a fixed 76px near-black icon rail. See
          icon-rail.tsx for why it doesn't collapse and has no sub-menus. */}
      <IconRail
        items={railNav}
        navLabel={tApp("nav_primary_label")}
        labels={labels}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        userAvatarUrl={userAvatarUrl}
        brandColor={brandColor}
      />

      {/* Main content — offset matches the sidebar width on desktop.
          Mobile gets bottom padding to clear the tab bar. */}
      <div
        className={cn(
          // min-w-0: this is a flex child; without it the default min-width:auto
          // refuses to shrink below its content's intrinsic width, so a wide
          // child (e.g. the worklist table at a large viewport) pushes the whole
          // content column past the viewport — the page then scrolls/pulls
          // horizontally by ~the sidebar width. min-w-0 lets it size to the
          // available width; <main> below clips any remaining child overflow
          // (and the table keeps its own internal scroll).
          // One fixed offset now — the rail never changes width, so the
          // left-margin transition the collapse toggle needed is gone. The right
          // margin still animates for the expandable messaging sidebar.
          "flex-1 min-w-0 flex flex-col min-h-screen transition-[margin-right] duration-300 ease-out sm:ml-[var(--rail-width)] sm:mr-[var(--assistant-shell-offset)]",
        )}
      >
        {topBar && (
          <div className="sticky top-0 z-20">
            {topBar}
          </div>
        )}

        <main
          className={cn(
            // overflow-x-clip: the in-app content area NEVER scrolls/pulls
            // horizontally. Any component that legitimately needs width (the
            // worklist table, the templates strip) carries its OWN
            // overflow-x-auto, so it scrolls internally rather than dragging the
            // whole page left — the bug a Mac/Safari user hit on the Overview.
            // clip (not hidden) keeps overflow-y visible, so position:sticky
            // inside main still works. The sticky top bar is outside <main>.
            "flex-1 mx-auto w-full overflow-x-clip px-4 sm:px-8 pt-4 sm:pt-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8 animate-in-fade",
            // The data-dense pages (Overview, Clients, Engagements list +
            // detail) get a wider cap on large monitors (>=1800px) so they fill
            // a 27" screen instead of letterboxing. Forms (New engagement) and
            // every smaller screen (MacBooks, laptops, phones) stay at 1600px,
            // byte-identical to before.
            pathname === "/dashboard" ||
            pathname === "/clients" ||
            (pathname.startsWith("/engagements") &&
              pathname !== "/engagements/new")
              ? "max-w-[1600px] min-[1800px]:max-w-[2100px]"
              : "max-w-[1600px]",
          )}
        >
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
            teamEnabled={teamEnabled}
            onItemClick={() => setMobileAccountOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Global command palette — opened by the sidebar search trigger or
          Cmd/Ctrl-K. Mounted once; renders into a portal. */}
      <CommandPalette isOwner={isOwner} quickbooksConnected={quickbooksConnected} />
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
  const tApp = useTranslations("App");
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
      aria-label={tApp("nav_bottom_label")}
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
  teamEnabled,
  onItemClick,
}: {
  labels: Labels;
  brandColor: string;
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  teamEnabled: boolean;
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
          {teamEnabled && (
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
          {/* The public help center. New tab (founder spec) so a user reading
              a guide doesn't lose the screen they were stuck on. */}
          <a
            href="/help"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onItemClick}
            className="w-full flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-medium text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent shrink-0">
              <BookOpen className="size-4" aria-hidden />
            </span>
            <span className="flex-1 text-left">{labels.helpCenter}</span>
          </a>
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

