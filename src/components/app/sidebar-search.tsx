"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { COMMAND_PALETTE_EVENT } from "@/components/app/command-palette";

// Sidebar search trigger. Looks like a search input but is a button — clicking
// it (or pressing Cmd/Ctrl-K anywhere) opens the full command palette, which
// owns the actual querying, recents and results. Keeps the palette logic in
// one place and the sidebar lightweight.

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

// The Cmd-vs-Ctrl hint depends on the OS, which is only known on the client.
// useSyncExternalStore returns null during SSR and the real key after
// hydration — no hydration mismatch and no setState-in-effect.
const subscribeToNothing = () => () => {};

function getModKey() {
  return /mac|iphone|ipad|ipod/i.test(
    navigator.platform || navigator.userAgent,
  )
    ? "⌘"
    : "Ctrl";
}

function useModKey() {
  return useSyncExternalStore(subscribeToNothing, getModKey, () => null);
}

export function SidebarSearch() {
  const t = useTranslations("Home");
  const modKey = useModKey();

  return (
    <button
      type="button"
      data-command-palette-trigger
      onClick={openCommandPalette}
      aria-label={t("search_label")}
      aria-keyshortcuts="Meta+K Control+K"
      className="group flex h-9 w-full items-center gap-2 rounded-lg border border-border/60 bg-background/40 pl-3 pr-2 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate text-left">
        {t("search_placeholder")}
      </span>
      {modKey && (
        <kbd className="pointer-events-none hidden shrink-0 select-none items-center gap-0.5 rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs leading-none">{modKey}</span>K
        </kbd>
      )}
    </button>
  );
}
