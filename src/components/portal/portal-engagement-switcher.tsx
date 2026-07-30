"use client";

// The portal header's engagement switcher — a dead-simple way for a client with
// more than one engagement at this firm to hop between them without juggling
// separate links. Rendered in place of the static engagement title only when
// there are 2+ engagements (see PortalShell).
//
// Each sibling is an anchor to the guarded /r/[token]/to/[id] route, which
// resolves that sibling's magic token server-side — no tokens live in this
// markup, so a shared/leaked portal link never exposes the client's other links.

import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// PURE: the guarded switch-route href for a sibling engagement. English is the
// portal default, so only French needs carrying across the hop. Exported for a
// unit test (Radix menus are awkward to open in jsdom).
export function switchHref(
  token: string,
  engagementId: string,
  locale: "fr" | "en",
): string {
  return `/r/${token}/to/${engagementId}${locale === "fr" ? "?lang=fr" : ""}`;
}

export function PortalEngagementSwitcher({
  token,
  currentId,
  engagements,
  locale,
}: {
  token: string;
  currentId: string;
  engagements: { id: string; title: string; status: string }[];
  locale: "fr" | "en";
}) {
  const t = useTranslations("Portal");
  const current = engagements.find((e) => e.id === currentId);

  return (
    <DropdownMenu>
      {/* The trigger sits in the always-dark firm header, so it's white-based;
          the menu below renders on its own theme-aware popover surface. */}
      <DropdownMenuTrigger className="group -ml-0.5 flex min-w-0 items-center gap-1 rounded-md px-0.5 text-xs text-white/[0.62] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
        <span className="truncate">{current?.title ?? ""}</span>
        <ChevronsUpDown
          className="size-3 shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <span className="sr-only">{t("switch_engagement")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(20rem,90vw)]">
        {engagements.map((e) => {
          const isCurrent = e.id === currentId;
          if (isCurrent) {
            return (
              <DropdownMenuItem
                key={e.id}
                aria-current="true"
                className="font-medium"
              >
                <span className="truncate">{e.title}</span>
                <Check
                  className="ml-auto size-4 shrink-0 text-accent"
                  aria-hidden
                />
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={e.id} asChild>
              <a href={switchHref(token, e.id, locale)}>
                <span className="truncate">{e.title}</span>
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
