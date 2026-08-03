"use client";

// The firm name, with a dropdown — Discord's server menu.
//
// The founder's reference is exact: in Discord the server name at the top of
// the sidebar carries a chevron, and clicking it opens the menu that holds
// everything you can DO to the server. Vylan had the firm name as a plain
// heading and every firm-level action scattered across tabs and a "⋯" nobody
// opens.
//
//
// ── WHAT THIS MENU DOES *NOT* HOLD ───────────────────────────────────────────
//
// Anything that is a TAB on the page behind it. The founder, seeing both:
// "there's now a dropdown menu with options that do not live on the header
// tabs… and then there's settings and people."
//
// The rule we settled on: a PLACE you look at is a tab; a thing you DO is in
// here; nothing appears in both. So "Firm settings" left (it is a tab) and so
// did "Members" — that one opened a floating panel listing the same people as
// the Members tab directly behind the open menu, which is two ways to read one
// list.
//
// Roles and Activity log are still here ONLY because they are not tabs yet.
// When they become tabs they leave too, and this menu is actions alone.
//
// The trigger itself lives in NameMenu, shared with the client page — the
// founder asked for "the exact same thing" there, and the way to make that
// true in six months is for it to be the same component today.

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { ScrollText, ShieldHalf, UserPlus } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NameMenu } from "@/components/ui/name-menu";

export function FirmMenu({
  firmName,
  canManage,
  onInvite,
}: {
  firmName: string;
  canManage: boolean;
  /** Opens the invite dialog the team page already owns. */
  onInvite?: () => void;
}) {
  const t = useTranslations("Team");

  return (
    <NameMenu
        name={firmName}
        label={t("firm_menu_label")}
        enabled={canManage}
        className="text-2xl sm:text-3xl"
      >
        {onInvite && (
          <>
            <DropdownMenuItem onSelect={() => onInvite()} className="gap-2">
              <UserPlus className="size-4" aria-hidden />
              {t("invite_button")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {/* "Edit firm" USED TO BE HERE, pointing at /settings?tab=account,
            while the Settings TAB on the page behind this menu pointed
            somewhere else — two destinations for one idea, which is the split
            the founder objected to. The firm's identity (name, logo, brand
            colour, client email language) now renders on that Settings tab
            beside the firm-wide switches, so there is one place, and by the
            rule above it is a tab rather than an item in here. */}
        {/* Roles is its own destination, not a block inside settings. That is
            the founder's whole point of reference: in Discord you open Roles
            and get a page, not a paragraph. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/team/roles">
            <ShieldHalf className="size-4" aria-hidden />
            {t("roles_title")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/audit">
            <ScrollText className="size-4" aria-hidden />
            {t("firm_menu_audit")}
          </Link>
        </DropdownMenuItem>
    </NameMenu>
  );
}
