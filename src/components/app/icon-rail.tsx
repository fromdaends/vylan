"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  BookOpen,
  HelpCircle,
  LogOut,
  Plus,
  Search,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openCommandPalette } from "@/components/app/sidebar-search";
import { logoutAction } from "@/app/actions/auth";
import { isNavItemActive, isPanelItemActive } from "@/lib/navigation/active-nav";
import {
  RailFlyout,
  type FlyoutAction,
  type FlyoutItem,
} from "@/components/app/rail-flyout";

// The primary desktop navigation: a FIXED 76px icon rail (Canopy-style), from
// the founder's Claude Design import. It replaced the old expandable 64/256px
// sidebar, and the trade-offs are deliberate:
//
//  - It never collapses. At 76px there's nothing to gain by hiding it, so the
//    collapse toggle, its persisted preference, and the width transition are all
//    gone (main content now has one fixed offset instead of two).
//  - It is FLAT — no expandable Engagements / Integrations sub-lists. Nothing
//    became unreachable: the Engagements page already carries a tab strip for all
//    six views, and the Integrations hub already lists every product as a card.
//    The old sub-menus were duplicating navigation that lives inside those pages.
//  - It stays near-black in BOTH themes (not a themed surface), the way Canopy
//    and Linear treat their rails, so it reads as chrome rather than page.
//
// Mobile is untouched: this is hidden below `sm` and the bottom tab bar remains
// the phone navigation.
//
// Width lives in --rail-width (globals.css) because the main content offsets by
// the same value; keeping it in one place stops the two drifting apart.

// Near-black, slightly cooler than pure #000 so it separates from a black page
// background in dark mode.
const RAIL_BG = "#0a0a0c";

export type RailItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * When present the item OPENS a second sidebar instead of navigating.
   *
   * The rail was built flat on purpose (see the note at the top of this file),
   * and this is the one deliberate exception: a section that genuinely holds
   * more than one list should let you choose which, rather than landing you on
   * whichever one happened to be picked as the default. `href` stays set — it
   * is what the rail highlights against.
   */
  panel?: { title: string; items: FlyoutItem[]; actions?: FlyoutAction[] };
};

// The + button's panel is keyed like a rail item so it can reuse the open/close,
// focus and page-push machinery unchanged — but it is not a destination, so it
// gets a sentinel that can never collide with a real route.
const CREATE_PANEL_KEY = "__create__";

export function IconRail({
  items,
  createPanel,
  footerItem,
  navLabel,
  labels,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  brandColor,
}: {
  items: RailItem[];
  /**
   * What the + button opens. Absent → + stays a plain link to its href.
   *
   * The + used to navigate straight to /engagements/new. That made the rail's
   * most prominent control answer one question ("a new engagement?") when the
   * thing you actually want to make varies — which is exactly what Canopy's
   * Create panel solves by asking first.
   */
  createPanel?: { title: string; items: FlyoutItem[]; actions?: FlyoutAction[] };
  // Pinned below the scrolling nav, above the account avatar. For a destination
  // that must ALWAYS be visible and labelled whatever the viewport height: the
  // nav above is overflow-y-auto with a hidden scrollbar (see its comment), so a
  // list item that falls past the fold keeps its icon on screen but loses its
  // LABEL — an unlabelled glyph jammed against the avatar.
  footerItem?: RailItem;
  navLabel: string;
  labels: {
    profile: string;
    settings: string;
    help: string;
    helpCenter: string;
    logout: string;
    // The logo is now the ONLY route to Overview (its nav row was removed as a
    // duplicate destination), so the accessible name has to say where it goes —
    // the brand mark alone tells a screen-reader user nothing about the target.
    dashboard: string;
    /** Names the button that dismisses a section's second sidebar. */
    closePanel: string;
  };
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  brandColor: string;
}) {
  const tHome = useTranslations("Home");
  const pathname = usePathname();
  // Which section's second sidebar is open, if any. Null is the ordinary case.
  const [panel, setPanel] = useState<RailItem | null>(null);
  // The button that opened the panel, so closing hands focus back to it. A
  // keyboard user who presses Escape and lands nowhere has to tab in from the
  // top of the document to carry on.
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Whether the open came from the keyboard. Focus — and therefore the ring —
  // follows this rather than the click, so a mouse user never picks up a
  // highlight on a row they only walked past.
  const [openedViaKeyboard, setOpenedViaKeyboard] = useState(false);

  // Narrowed once here so the render below can read item.panel without a
  // non-null assertion on every line.
  const createPanelItem: RailItem | null = createPanel
    ? { href: CREATE_PANEL_KEY, label: createPanel.title, icon: Plus, panel: createPanel }
    : null;

  const panelItems = [
    ...items,
    // The + panel rides the same list, so it is mounted (and therefore
    // animatable) on exactly the same terms as every section panel.
    ...(createPanelItem ? [createPanelItem] : []),
  ].filter(
    (i): i is RailItem & { panel: NonNullable<RailItem["panel"]> } =>
      i.panel != null,
  );

  // How far the page moves over, written in ONE place. The flyout could set
  // this itself, but with more than one panel section the closing panel's
  // cleanup and the opening panel's effect would race to write the same
  // variable, and whichever landed second would win. The rail knows which
  // panel is open; nothing else has to agree with it.
  useEffect(() => {
    const root = document.documentElement;
    if (!panel?.panel) {
      root.style.removeProperty("--rail-flyout-offset");
      return;
    }
    // Pointed at the width rather than a copy of it, so the panel's width and
    // the distance the page moves can never disagree — they are the same
    // declaration read twice.
    //
    // If you ever come here to check this with getComputedStyle: the content
    // column TRANSITIONS its margin, so a computed read taken in the same tick
    // as the change returns a value part-way through the animation, not the
    // target. It reads like the push is broken when it is only in progress.
    root.style.setProperty("--rail-flyout-offset", "var(--rail-flyout-width)");
    return () => {
      root.style.removeProperty("--rail-flyout-offset");
    };
  }, [panel]);
  // Logout submits through this ref: a submit button nested in a Radix
  // DropdownMenuItem has its click swallowed by the menu's selection handling,
  // so requestSubmit() from onSelect is what actually posts (carried over from
  // the old sidebar, where this was a real bug).
  const logoutFormRef = useRef<HTMLFormElement>(null);

  return (
    <aside
      aria-label={navLabel}
      // Marks the rail for the flyout's click-outside check, which lets a click
      // on a DIFFERENT section switch panels instead of merely dismissing.
      data-rail
      style={{ background: RAIL_BG }}
      className="hidden sm:flex sm:fixed sm:inset-y-0 sm:left-0 sm:z-30 sm:w-[var(--rail-width)] sm:flex-col sm:items-center sm:px-2.5 sm:pb-4 sm:pt-4"
    >
      {/* Brand — and the way to Overview. Given deliberate breathing room below
          (founder): the gap that follows is what isolates the logo from the
          action buttons, so the mark reads as the product rather than as the
          first item in a toolbar. It carries the Overview label because the
          separate Overview row was removed as a duplicate destination. */}
      <Link
        href="/dashboard"
        aria-label={labels.dashboard}
        title={labels.dashboard}
        aria-current={
          isNavItemActive(pathname, "/dashboard") ? "page" : undefined
        }
        className="group inline-flex size-[60px] shrink-0 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Image
          src="/logo-vylan.png"
          alt=""
          width={46}
          height={46}
          priority
          className="size-[46px] object-contain transition-transform duration-[400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.08] group-hover:-rotate-[4deg] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-hover:rotate-0"
        />
      </Link>

      {/* Create — the rail's primary action, in brand blue. OPENS rather than
          navigates: it used to go straight to /engagements/new, which answered
          one question when the thing you want to make varies. */}
      {createPanel ? (
        <button
          type="button"
          onClick={(e) => {
            panelTriggerRef.current = e.currentTarget;
            // detail === 0 means Enter/Space rather than a pointer — the same
            // modality test the section panels use, so a mouse user never picks
            // up a focus ring on a row they only walked past.
            setOpenedViaKeyboard(e.detail === 0);
            setPanel((current) =>
              current?.href === CREATE_PANEL_KEY ? null : createPanelItem,
            );
          }}
          aria-label={createPanel.title}
          title={createPanel.title}
          aria-expanded={panel?.href === CREATE_PANEL_KEY}
          className="mt-8 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Plus
            aria-hidden
            className={cn(
              "size-[18px] transition-transform duration-200",
              // Turns into an x. The button is the only way to shut the panel
              // from the rail, so it has to look like a toggle while it is open.
              panel?.href === CREATE_PANEL_KEY && "rotate-45",
            )}
          />
        </button>
      ) : (
        <Link
          href="/engagements/new"
          aria-label={tHome("new_engagement")}
          title={tHome("new_engagement")}
          className="mt-8 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Plus className="size-[18px]" aria-hidden />
        </Link>
      )}

      {/* Search — opens the same command palette as Cmd/Ctrl-K. */}
      <button
        type="button"
        data-command-palette-trigger
        onClick={openCommandPalette}
        aria-label={tHome("search_label")}
        aria-keyshortcuts="Meta+K Control+K"
        title={tHome("search_label")}
        className="mt-2 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <Search className="size-[19px]" aria-hidden />
      </button>

      <nav
        // Hidden scrollbar: a firm with the Bookkeeping tab shown can overflow a
        // short viewport, and a visible bar inside a 76px rail is all noise.
        className="mt-4 flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <RailLink
            key={item.href}
            item={item}
            active={isNavItemActive(pathname, item.href)}
            panelOpen={panel?.href === item.href}
            onOpenPanel={
              item.panel
                ? (el, viaKeyboard) => {
                    panelTriggerRef.current = el;
                    setOpenedViaKeyboard(viaKeyboard);
                    // Clicking the section you are already inside CLOSES it.
                    // Without this the only way out is the X, and a control
                    // that opens but never closes reads as broken.
                    setPanel((current) =>
                      current?.href === item.href ? null : item,
                    );
                  }
                : undefined
            }
          />
        ))}
      </nav>

      {/* The second sidebar, when a section has one. Rendered here rather than
          at the page level so it sits against the rail it belongs to and does
          not have to know what page is behind it. */}
      {/* One per panel-bearing section, all of them mounted. Rendering only the
          OPEN one would mean its first appearance has no previous frame to
          transition from, so the very first open of a session would still snap
          into place — the bug this is fixing, surviving in the one case nobody
          would think to re-test. */}
      {panelItems.map((item) => (
        <RailFlyout
          key={item.href}
          open={panel?.href === item.href}
          title={item.panel.title}
          items={item.panel.items}
          actions={item.panel.actions}
          // isPanelItemActive, NOT isNavItemActive. The rail's rule deliberately
          // treats /engagements as part of /work so the section stays lit across
          // both — correct one level up, wrong here, where it would match Tasks
          // first and highlight the wrong row on the engagements page.
          // Actions FIRST, then rows: a panel whose destinations live in the
          // button strip (Work) has no rows to match against, and one whose
          // buttons are ?new=1 links (Create) never matches here at all.
          activeHref={
            (item.panel.actions ?? []).find((a) =>
              isPanelItemActive(pathname, a.href),
            )?.href ??
            item.panel.items.find((i) => isPanelItemActive(pathname, i.href))
              ?.href ??
            null
          }
          closeLabel={labels.closePanel}
          autoFocus={openedViaKeyboard}
          onClose={(opts) => {
            setPanel(null);
            // Only on a keyboard close. Refocusing after a click is what put a
            // ring around the Work item and left it sitting there.
            if (opts?.restoreFocus) panelTriggerRef.current?.focus();
          }}
        />
      ))}

      {/* Firm sits here rather than in the list above: it is a firm-level
          destination — the same spot the old sidebar kept its quiet firm button
          — and pinning it means it never scrolls out of view on a short screen. */}
      {footerItem && (
        <div className="mt-2 flex w-full shrink-0 flex-col items-center border-t border-white/[0.08] pt-3">
          <RailLink
            item={footerItem}
            active={isNavItemActive(pathname, footerItem.href)}
          />
        </div>
      )}

      {/* Account — the same menu the old sidebar's profile card opened. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={userDisplayName}
            title={`${userDisplayName} — ${userEmail}`}
            className="mt-2.5 inline-flex shrink-0 items-center justify-center rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.18)]"
          >
            <AvatarInitials
              src={userAvatarUrl}
              name={userDisplayName}
              size={34}
              color={brandColor}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-60"
          // Don't hand focus back to the trigger: every item navigates or acts,
          // and the returning focus ring made the avatar look stuck "selected".
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="font-normal">
            <div className="truncate font-medium">{userDisplayName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {userEmail}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile" className="flex cursor-pointer items-center gap-2">
              <UserCircle className="h-4 w-4" />
              {labels.profile}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex cursor-pointer items-center gap-2">
              <Settings className="h-4 w-4" />
              {labels.settings}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            onSelect={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("vylan:open-help"));
            }}
          >
            <HelpCircle className="h-4 w-4" />
            {labels.help}
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer">
            <a
              href="/help"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <BookOpen className="h-4 w-4" />
              {labels.helpCenter}
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form ref={logoutFormRef} action={logoutAction}>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2 text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                logoutFormRef.current?.requestSubmit();
              }}
            >
              <LogOut className="h-4 w-4" />
              {labels.logout}
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}

// One rail destination. Extracted so the scrolling list and the pinned footer
// item render byte-identically — if they drifted, the pinned one would quietly
// stop looking like a nav item.
function RailLink({
  item,
  active,
  panelOpen = false,
  onOpenPanel,
}: {
  item: RailItem;
  active: boolean;
  /** Whether THIS item's second sidebar is the one currently open. */
  panelOpen?: boolean;
  /**
   * Set for a section that opens a second sidebar rather than navigating. It is
   * handed the button element (so the rail can put focus back on it) and
   * whether the activation came from the keyboard (so the panel knows whether
   * to take focus at all).
   */
  onOpenPanel?: (el: HTMLButtonElement, viaKeyboard: boolean) => void;
}) {
  const Icon = item.icon;
  // Same classes either way — a button that looked unlike its neighbours would
  // read as a different kind of thing, and it is not. Written as two branches
  // rather than one polymorphic tag because Link and button disagree about
  // their props, and casting that away is how a typo becomes a runtime error.
  const className = cn(
    "relative flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-[10px] px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
    // The selected item is marked by the underline bar below, never by a
    // filled pill — hover keeps its wash so the rail still feels clickable.
    // An OPEN panel lights its own item too, even on a page from a different
    // section — otherwise the panel appears to belong to nothing.
    active || panelOpen
      ? "text-white"
      : "text-white/[0.68] hover:bg-white/[0.08] hover:text-white",
    panelOpen && "bg-white/[0.10]",
  );
  const inner = (
    <>
      <Icon className="size-[22px]" aria-hidden />
      <span
        className={cn(
          "text-center text-[10px] leading-none tracking-[0.01em]",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
      {active ? (
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-sm bg-white"
        />
      ) : null}
    </>
  );

  if (onOpenPanel) {
    return (
      <button
        type="button"
        // detail === 0 means Enter or Space rather than a pointer. It is the
        // standard signal for "activated" versus "clicked", and here it decides
        // whether focus moves into the panel.
        onClick={(e) => onOpenPanel(e.currentTarget, e.detail === 0)}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
      {inner}
    </Link>
  );
}


