"use client";

// The firm name, with a dropdown — Discord's server menu.
//
// The founder's reference is exact: in Discord the server name at the top of
// the sidebar carries a chevron, and clicking it opens the menu that holds
// everything you can DO to the server. Vylan had the firm name as a plain
// heading and every firm-level action scattered across tabs and a "⋯" nobody
// opens.
//
// The name itself is still just a name — the chevron is the affordance, and it
// rotates on open so the menu's state is legible without reading it.

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  ChevronDown,
  ScrollText,
  Settings,
  ShieldHalf,
  UserPlus,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const [open, setOpen] = useState(false);

  // Staff get the name and nothing else. A chevron that opens a menu of things
  // you cannot do is worse than no chevron.
  if (!canManage) {
    return (
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {firmName}
      </h1>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {firmName}
          </span>
          <ChevronDown
            className={`mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden
          />
          <span className="sr-only">{t("firm_menu_label")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
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
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/team?tab=people">
            <Users className="size-4" aria-hidden />
            {t("firm_menu_members")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/settings/audit">
            <ScrollText className="size-4" aria-hidden />
            {t("firm_menu_audit")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
