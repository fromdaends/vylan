"use client";

import { useRef } from "react";
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
import { isNavItemActive } from "@/lib/navigation/active-nav";

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
};

export function IconRail({
  items,
  footerItem,
  navLabel,
  labels,
  userDisplayName,
  userEmail,
  userAvatarUrl,
  brandColor,
}: {
  items: RailItem[];
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
  };
  userDisplayName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  brandColor: string;
}) {
  const tHome = useTranslations("Home");
  const pathname = usePathname();
  // Logout submits through this ref: a submit button nested in a Radix
  // DropdownMenuItem has its click swallowed by the menu's selection handling,
  // so requestSubmit() from onSelect is what actually posts (carried over from
  // the old sidebar, where this was a real bug).
  const logoutFormRef = useRef<HTMLFormElement>(null);

  return (
    <aside
      aria-label={navLabel}
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

      {/* New engagement — the rail's primary action, in brand blue. */}
      <Link
        href="/engagements/new"
        aria-label={tHome("new_engagement")}
        title={tHome("new_engagement")}
        className="mt-8 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <Plus className="size-[18px]" aria-hidden />
      </Link>

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
          />
        ))}
      </nav>

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
function RailLink({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-[10px] px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        // The selected item is marked by the underline bar below, never by a
        // filled pill — hover keeps its wash so the rail still feels clickable.
        active ? "text-white" : "text-white/[0.68] hover:bg-white/[0.08] hover:text-white",
      )}
    >
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
    </Link>
  );
}
