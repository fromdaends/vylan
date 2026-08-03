"use client";

// The firm name, with a dropdown — Discord's server menu.
//
// The founder's reference is exact: in Discord the server name at the top of
// the sidebar carries a chevron, and clicking it opens the menu that holds
// everything you can DO to the server. Vylan had the firm name as a plain
// heading and every firm-level action scattered across tabs and a "⋯" nobody
// opens.
//
// The trigger itself lives in NameMenu, shared with the client page — the
// founder asked for "the exact same thing" there, and the way to make that
// true in six months is for it to be the same component today.

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  ScrollText,
  Settings,
  ShieldHalf,
  UserPlus,
  Users,
} from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NameMenu } from "@/components/ui/name-menu";
import {
  MembersDialog,
  type DialogMember,
} from "@/components/settings/team/members-dialog";

export function FirmMenu({
  firmName,
  canManage,
  onInvite,
  members = [],
}: {
  firmName: string;
  canManage: boolean;
  /** Opens the invite dialog the team page already owns. */
  onInvite?: () => void;
  /** Everyone active, for the Members panel. */
  members?: DialogMember[];
}) {
  const t = useTranslations("Team");
  const [membersOpen, setMembersOpen] = useState(false);

  return (
    <>
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
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/team?tab=settings">
            <Settings className="size-4" aria-hidden />
            {t("firm_menu_settings")}
          </Link>
        </DropdownMenuItem>
        {/* Name, logo, brand colour, default language — the firm's identity,
            which lives on the account screen rather than the team one. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings?tab=account">
            <Building2 className="size-4" aria-hidden />
            {t("edit_firm")}
          </Link>
        </DropdownMenuItem>
        {/* Roles is its own destination, not a block inside settings. That is
            the founder's whole point of reference: in Discord you open Roles
            and get a page, not a paragraph. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/team/roles">
            <ShieldHalf className="size-4" aria-hidden />
            {t("roles_title")}
          </Link>
        </DropdownMenuItem>
        {/* Opens a PANEL, not a link. This item used to point at
            /settings/team?tab=people — the page you are standing on when the
            menu is open, so clicking it did nothing at all. */}
        <DropdownMenuItem
          onSelect={() => setMembersOpen(true)}
          className="gap-2"
        >
          <Users className="size-4" aria-hidden />
          {t("firm_menu_members")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/audit">
            <ScrollText className="size-4" aria-hidden />
            {t("firm_menu_audit")}
          </Link>
        </DropdownMenuItem>
      </NameMenu>

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        members={members}
        canOpenProfiles={canManage}
      />
    </>
  );
}
