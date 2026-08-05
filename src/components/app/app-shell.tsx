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
  CircleCheckBig,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings,
  Sparkles,
  UserCircle,
  UserPlus,
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
  work: string;
  workTasks: string;
  workEngagements: string;
  // One line each, under the label in the rail's second sidebar.
  workTasksHint: string;
  workEngagementsHint: string;
  workDashboard: string;
  workDashboardHint: string;
  closePanel: string;
  engagementsToggle: string;
  templates: string;
  // The firm-wide document browser. Sits between Templates and Engagements
  // because that is where it belongs in the mental model: the things you set up
  // (templates), the things you have (files), the work in flight (engagements).
  files: string;
  // The firm's invoices to ITS clients. Not the Vylan subscription page, which
  // is in Settings.
  billing: string;
  bookkeeping: string;
  // The Vylan hub's rail label. One word by design — it has to sit on one line
  // in a 72px rail slot.
  vylanHub: string;
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
  // Shows the QuickBooks Integrations sub-item + drives the Bookkeeping tab.
  quickbooksConnected?: boolean;
  // Together with quickbooksConnected, drives the top-level "Bookkeeping" tab:
  // it appears once the firm has ANY bookkeeping connection (QuickBooks OR Xero),
  // since the drafts queue is a shared surface.
  xeroConnected?: boolean;
}) {
  const pathname = usePathname();
  const tApp = useTranslations("App");
  const tHome = useTranslations("Home");
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);

  // Routes that draw their own full-width canvas. Exact match on purpose:
  // /files is full-bleed, but /files/organize is a normal review screen and
  // keeps the shell's centered column — same for /billing vs its sub-routes.
  const fullBleed =
    pathname === "/files" ||
    pathname === "/billing" ||
    pathname === "/clients" ||
    pathname === "/quickbooks/drafts" ||
    pathname.startsWith("/templates/") ||
    // A client PROFILE too — its overview is a three-column grid that needs
    // the width. Sub-routes (/clients/import, /clients/[id]/archive) are
    // ordinary screens and keep the centred column.
    /^\/clients\/(?!import$)[^/]+$/.test(pathname);

  // Close the mobile account sheet on route change (e.g. user tapped
  // a menu link). Ref-guarded to avoid setting state on every render.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      setMobileAccountOpen(false);
    }
  }, [pathname]);

  // The icon rail's destinations, in order. Flat by design — Engagements is a
  // single link, because its own page already carries the sub-navigation the
  // old expandable section duplicated.
  const railNav: RailItem[] = [
    // NOTE: no Overview entry. The brand logo at the top of the rail already
    // links to /dashboard, so a second Overview row was two rows pointing at one
    // destination (founder). The logo IS the way home; the Vylan hub inherits
    // the first slot.
    //
    // The Vylan hub — the firm's own automation surface. Sparkles is the app's
    // established AI mark (the chat popup's "Vylan" tab uses it), so the nav and
    // the assistant agree. Document filing USED to be its second tab; it moved
    // to /files?tab=settings, where it sits beside the documents it files.
    // Performance USED to be the second entry. The page is retired: its money
    // half became the Billing section below, its documents half was dropped,
    // and the AI numbers moved onto the Vylan hub as a second tab. /performance
    // redirects there rather than 404ing.
    { href: "/vylan", label: labels.vylanHub, icon: Sparkles },
    { href: "/clients", label: labels.clients, icon: Users },
    // TEMPLATES OPENS rather than navigates — the second rail item to do so,
    // for the same reason Work does: it holds four different lists and none of
    // them is the obvious default. Landing somebody on Engagement templates
    // when they came to edit a service is a scroll to undo.
    //
    // Canopy's own Templates panel is what this mirrors, and it is a plain row
    // list — no button strip. Its eleven rows are eleven template TYPES; ours
    // are four, because four is how many Vylan actually has. Canopy's other
    // seven (Folder, Email, Letter, eSign, Client Record, Boilerplate Letter
    // Text, Client Portal Invitation, Resolution Case) have no counterpart
    // here, and a row that opens nothing is worse than a shorter list.
    //
    // THE NAMES ARE CANOPY'S WHERE THE CONCEPT MATCHES. Canopy calls a priced
    // line an "Engagement Item" and a document ask a "Client Request"; Vylan
    // called them Service and Document request. Where the founder is
    // replicating Canopy, the word should be Canopy's — but renaming the
    // SECTIONS is a visible change to a page they use, so the panel uses the
    // page's own headings for now and the rename is noted for them to call.
    {
      href: "/templates",
      label: labels.templates,
      icon: FileText,
      panel: {
        title: labels.templates,
        // Ordered biggest-to-smallest, matching the page itself: a whole job,
        // then the steps inside one, then the two building blocks.
        items: [
          {
            href: "/templates/engagements",
            label: tHome("templates_engagement"),
            description: tHome("templates_engagement_hint"),
          },
          {
            href: "/templates/tasks",
            label: tHome("templates_task"),
            description: tHome("templates_task_hint"),
          },
          {
            href: "/templates/requests",
            label: tHome("templates_request"),
            description: tHome("templates_request_hint"),
          },
          {
            href: "/templates/services",
            label: tHome("templates_service"),
            description: tHome("templates_service_hint"),
          },
        ],
      },
    },
    // Files — every client document in one place, plus the filing settings that
    // decide where copies land in the firm's cloud storage.
    { href: "/files", label: labels.files, icon: FolderOpen },
    // Billing — every invoice the firm has raised, what is owed, and who is
    // being chased. Sits between Files and Engagements because it follows the
    // same mental model as the rest of the rail: the things you have (files),
    // the money they turned into (billing), the work in flight (engagements).
    //
    // NOTE: /billing is THIS section. The firm's own Vylan subscription lives
    // at /settings/billing — it moved there when this shipped, because two
    // things called Billing in one sidebar is how confusion starts.
    { href: "/billing", label: labels.billing, icon: Receipt },
    // WORK — the firm's whole workload. Replaces the Engagements item rather
    // than sitting beside it: two doors into one room is what the founder
    // objected to on the firm menu, and it is the same mistake here. The
    // engagements list is one tab inside it and keeps its own URL, so every
    // existing link and bookmark still lands.
    {
      href: "/work",
      label: labels.work,
      icon: CircleCheckBig,
      // The one rail item that OPENS rather than navigates. Work holds two
      // lists and neither is the obvious default, so it asks which — landing
      // somebody on Tasks when they wanted Engagements is a click and a page
      // load to undo.
      // Work's two destinations are ROWS, which is Canopy's shape.
      //
      // ⚠️ THIS REVERSES AN EARLIER CALL, deliberately. They were rows, then
      // became a round button strip when the founder saw the Create panel and
      // asked for "the same with the two blue icons". Then, with Canopy's Work
      // sidebar open beside ours: "change the work sidebar to replicate
      // canopys. So its Task list, Engagement list". Canopy's is a list —
      // Tasks List / Engagements List / Resolution Cases / Tax Organizers /
      // Dashboard, every one a plain row with a chevron — so rows it is.
      //
      // The two Canopy rows with no home here (Resolution Cases, Tax
      // Organizers) are simply absent rather than stubbed. Dashboard is next
      // and lands here when it exists.
      //
      // The one-line hints STAY. Bare rows are what this panel shipped with
      // the first time and the founder's verdict was "it looks HORRIBLE... the
      // text ui looks bad" — two words and a chevron in a 250px column is a
      // list with nothing to look at. Canopy can afford bare rows because it
      // has five of them; two need the second line.
      panel: {
        title: labels.work,
        items: [
          {
            href: "/work",
            label: labels.workTasks,
            description: labels.workTasksHint,
          },
          {
            href: "/engagements",
            label: labels.workEngagements,
            description: labels.workEngagementsHint,
          },
          // Canopy's fifth row, and the only one of their three we could
          // build: Resolution Cases and Tax Organizers have no home here.
          {
            href: "/work/dashboard",
            label: labels.workDashboard,
            description: labels.workDashboardHint,
          },
        ],
      },
    },
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
    // No Integrations tab: it lives in Settings > Integrations now (founder:
    // "no point in it being in the sidebar"). /integrations redirects there.
  ];

  // Settings lives in the account dropdown; Firm is pinned at the foot of the
  // rail (see footerItem below), because it is somewhere you GO rather than a
  // preference you set.

  return (
    <ActiveNavProvider>
    <div className="flex min-h-screen">
      {/* Desktop navigation — a fixed 76px near-black icon rail. See
          icon-rail.tsx for why it doesn't collapse and has no sub-menus. */}
      <IconRail
        items={railNav}
        // What the + opens. Canopy's shape: the two things you reach for most as
        // round buttons, then the longer list underneath.
        //
        // The BUTTONS navigate to the page that already owns the dialog and let
        // it open itself (?new=1) rather than opening one here. AddTaskDialog
        // needs the client and member lists and ClientFormDialog needs the
        // teammates; loading either in this shell would put that cost on every
        // page render for a panel that is shut almost all of the time.
        //
        // NO "Client Request" button, deliberately. Canopy has one; Vylan has no
        // standalone document-request object — asking a client for documents is
        // what an engagement's checklist IS — and inventing one here would mean a
        // data model, a portal surface and a migration. The founder's call was to
        // drop it for now rather than ship a button that half-means it.
        createPanel={{
          title: tHome("create_title"),
          // Bare nouns — "Task", not "Create task". The panel is already titled
          // Create, so repeating the verb on every button says it four times on
          // one small surface and makes the three labels different lengths for
          // no reason. Do not put the verbs back.
          actions: [
            { href: "/work?new=1", label: tHome("create_task"), icon: CircleCheckBig },
            { href: "/clients?new=1", label: tHome("create_client"), icon: UserPlus },
          ],
          items: [
            // Engagement is a ROW, not a button. It was briefly promoted to the
            // strip and the founder moved it back: the strip is for the two you
            // reach for constantly, and a third button made it the same weight
            // as Task and Client when it is not used nearly as often. As a row
            // it also gets its line of explanation back, which the other three
            // rows have and a button cannot carry.
            {
              href: "/engagements/new",
              label: tHome("create_engagement"),
              description: tHome("create_engagement_hint"),
            },
            {
              // Plain /billing, NOT ?new=1: the invoice picker renders nothing
              // at all for a firm with no payment rails connected, so an
              // auto-open would silently do nothing on exactly the firms least
              // likely to know why.
              href: "/billing",
              label: tHome("create_invoice"),
              description: tHome("create_invoice_hint"),
            },
            // BOTH kinds of template, as separate rows. They point at the
            // same page today, but they are different things you set up — one
            // is what you sell, the other is what you ask a client to send —
            // and collapsing them into "Templates" would hide the new one
            // behind a word that already meant the old one.
            {
              // These two CREATE one rather than going to look at the list —
              // founder: "the whole function is to create one not just bring
              // you to the page". A service now has a real create ROUTE like
              // every other builder, so it links straight to it; a document
              // request still clones the blank template and drops you in its
              // editor, because that is what creating one means.
              href: "/templates/services/new",
              label: tHome("create_service"),
              description: tHome("create_service_hint"),
            },
            {
              href: "/templates/requests/new",
              label: tHome("create_template"),
              description: tHome("create_template_hint"),
            },
            {
              href: "/clients/import",
              label: tHome("create_import"),
              description: tHome("create_import_hint"),
            },
          ],
        }}
        // Firm is PINNED below the list, not in it. Added to the list first, it
        // became the ninth item, fell past the fold of the rail's hidden-scrollbar
        // nav, and rendered as an unlabelled glyph pressed against the avatar.
        // NO LONGER team-gated. It used to be, on the grounds that the page was
        // just a "create a team" card with collaboration off — but that page is
        // now also the only place a firm edits its own name, logo, brand colour
        // and client email language, and a solo firm has all four. Hiding the
        // link would have made those uneditable for every new signup, since
        // team mode starts off (migration 0540).
        footerItem={{
          href: "/settings/team",
          label: labels.firm,
          icon: Building2,
        }}
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
          // The left margin animates again, but for a different reason than the
          // old collapse toggle: the rail's second sidebar PUSHES this column
          // aside rather than lying on top of it. That was the founder's first
          // complaint about it — "its overlapping with the page" — and a panel
          // that covers your work while you decide where to go is the wrong
          // object. --rail-flyout-offset is 0px until one opens.
          //
          // transition-[margin] rather than naming both sides: a comma-joined
          // arbitrary property list is one Tailwind parser quirk away from
          // silently producing no transition at all, and there is nothing else
          // on this element whose margin moves.
          "flex-1 min-w-0 flex flex-col min-h-screen transition-[margin] duration-300 ease-out sm:ml-[calc(var(--rail-width)+var(--rail-flyout-offset))] sm:mr-[var(--assistant-shell-offset)]",
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
            "flex-1 mx-auto w-full overflow-x-clip animate-in-fade",
            // FULL-BLEED ROUTES own their entire content area: no width cap and
            // no padding from the shell, because they set their own. /files is
            // a file manager — capping it at 1600px on a 27" monitor letterboxes
            // the one screen in the product that most wants the width, and the
            // shell's px-8 fought the page's own 44px gutter.
            fullBleed
              ? // Mobile still needs clearance for the bottom tab bar; the page
                // supplies its own bottom padding from `sm` up.
                "max-w-none pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-0"
              : cn(
                  "px-4 sm:px-8 pt-4 sm:pt-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8",
                  // The data-dense pages (Overview, Clients, Engagements list +
                  // detail) get a wider cap on large monitors (>=1800px) so they
                  // fill a 27" screen instead of letterboxing. Forms (New
                  // engagement) and every smaller screen (MacBooks, laptops,
                  // phones) stay at 1600px, byte-identical to before.
                  pathname === "/dashboard" ||
                    pathname === "/clients" ||
                    (pathname.startsWith("/engagements") &&
                      pathname !== "/engagements/new")
                    ? "max-w-[1600px] min-[1800px]:max-w-[2100px]"
                    : "max-w-[1600px]",
                ),
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
  onItemClick,
}: {
  labels: Labels;
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
          {/* "Edit firm" USED TO BE HERE, pointing at /settings?tab=account —
              the mobile copy of the item deleted from the firm dropdown, and
              the third surface for one idea. The firm's name, logo, brand
              colour and client email language are edited on the firm page's
              Settings tab now, which is exactly where the item below goes. */}
          <MobileMenuItem
            href="/settings/team"
            icon={Users2}
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

