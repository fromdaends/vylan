"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  Search,
  Clock,
  Users,
  Briefcase,
  FileText,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { logoutAction } from "@/app/actions/auth";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/cn";
import {
  buildSearchRegistry,
  matchEntries,
  type SearchEntry,
} from "@/lib/search/registry";
import {
  readRecentSearches,
  readRecentItems,
  recordSearch,
  recordItem,
  clearRecents,
  type RecentItem,
} from "@/lib/command-palette-recents";

// Vercel-style command palette. Mounted once in the app shell; opened by the
// sidebar search trigger (a CustomEvent) or Cmd/Ctrl-K from anywhere. Renders
// a top-anchored panel over a blurred + dimmed backdrop. While the query is
// short it shows recent searches, recently-opened items and quick-nav
// destinations; once you type it merges a static catalog of every page +
// action (src/lib/search/registry.ts) with live clients / engagements /
// templates streamed from /api/search.

export const COMMAND_PALETTE_EVENT = "vylan:command-palette";

type ClientHit = { id: string; display_name: string; email: string | null };
type EngagementHit = {
  id: string;
  title: string;
  client_id: string;
  client_display_name: string | null;
};
type TemplateHit = { id: string; name: string; is_builtin: boolean };

type Results = {
  clients: ClientHit[];
  engagements: EngagementHit[];
  templates: TemplateHit[];
};

const EMPTY_RESULTS: Results = { clients: [], engagements: [], templates: [] };

const MIN_CHARS = 2;
const DEBOUNCE_MS = 180;
// Keep the static catalog tidy in the list even on broad queries; the user
// narrows by typing more.
const MAX_GO = 8;
const MAX_ACTIONS = 6;

// Anchor the palette to the on-screen search trigger so it appears to grow
// out of the sidebar search box instead of as a centered modal. Falls back
// to the top-left when no trigger is visible (e.g. the mobile drawer is shut).
type Anchor = { left: number; top: number; width: number };

function measureAnchor(): Anchor {
  const fallback = (): Anchor => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 360;
    return { left: 12, top: 72, width: Math.min(vw - 24, 360) };
  };
  if (typeof document === "undefined") return fallback();
  const triggers = document.querySelectorAll<HTMLElement>(
    "[data-command-palette-trigger]",
  );
  for (const el of triggers) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      // Sit exactly where the trigger is, just a touch wider than it.
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.min(Math.max(Math.round(r.width) + 80, 300), 420),
      };
    }
  }
  return fallback();
}

export function CommandPalette({
  isOwner = false,
  quickbooksConnected = false,
}: {
  isOwner?: boolean;
  quickbooksConnected?: boolean;
}) {
  const t = useTranslations("CommandPalette");
  const tApp = useTranslations("App");
  const tEng = useTranslations("Engagements");
  const tSet = useTranslations("Settings");
  const tProfile = useTranslations("Profile");
  const tAuth = useTranslations("Auth");
  const router = useRouter();
  const { setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results>(EMPTY_RESULTS);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const trimmed = query.trim();
  const isSearching = trimmed.length >= MIN_CHARS;

  // The static, hand-curated catalog of every destination + action. Built from
  // i18n labels so it follows the UI language; owner-only entries (billing,
  // audit log, firm export/delete) are filtered out for staff.
  const registry = useMemo(
    () =>
      buildSearchRegistry(
        { app: tApp, eng: tEng, set: tSet, profile: tProfile, auth: tAuth, cmd: t },
        { isOwner, quickbooksConnected },
      ),
    [tApp, tEng, tSet, tProfile, tAuth, t, isOwner, quickbooksConnected],
  );
  const primaryDestinations = useMemo(
    () => registry.filter((e) => e.primary),
    [registry],
  );

  const entryMatches = useMemo(
    () => (isSearching ? matchEntries(registry, trimmed) : []),
    [isSearching, registry, trimmed],
  );
  const goMatches = entryMatches
    .filter((e) => e.group === "go")
    .slice(0, MAX_GO);
  const actionMatches = entryMatches
    .filter((e) => e.group === "action")
    .slice(0, MAX_ACTIONS);

  const refreshRecents = useCallback(() => {
    setRecentSearches(readRecentSearches());
    setRecentItems(readRecentItems());
  }, []);

  // Single entry point for every open/close. Refreshes recents on open and
  // resets the query/results on close so the palette always opens fresh.
  // openRef mirrors `open` synchronously so the keyboard toggle can read the
  // latest value without this callback having to depend on `open`.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      openRef.current = next;
      if (next) {
        setAnchor(measureAnchor());
        refreshRecents();
      } else {
        setQuery("");
        setResults(EMPTY_RESULTS);
        setLoading(false);
      }
      setOpen(next);
    },
    [refreshRecents],
  );

  // Global open triggers: Cmd/Ctrl-K toggles, the CustomEvent (from the
  // sidebar trigger) opens. handleOpenChange re-reads recents on open so the
  // list reflects anything recorded since the last time it was shown.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleOpenChange(!openRef.current);
      }
    }
    function onOpenEvent() {
      handleOpenChange(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, [handleOpenChange]);

  // Debounced fetch to /api/search while typing. An AbortController drops
  // stale responses; previous results stay on screen until the next land.
  useEffect(() => {
    if (!isSearching) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: ctrl.signal },
        );
        const data = res.ok
          ? ((await res.json()) as Partial<Results>)
          : EMPTY_RESULTS;
        setResults({
          clients: data.clients ?? [],
          engagements: data.engagements ?? [],
          templates: data.templates ?? [],
        });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setResults(EMPTY_RESULTS);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed, isSearching]);

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      close();
    },
    [router, close],
  );

  const openClient = useCallback(
    (c: ClientHit) => {
      if (isSearching) recordSearch(trimmed);
      recordItem({
        kind: "client",
        id: c.id,
        title: c.display_name,
        ...(c.email ? { subtitle: c.email } : {}),
      });
      go(`/clients/${c.id}`);
    },
    [go, isSearching, trimmed],
  );

  const openEngagement = useCallback(
    (e: EngagementHit) => {
      if (isSearching) recordSearch(trimmed);
      recordItem({
        kind: "engagement",
        id: e.id,
        title: e.title,
        ...(e.client_display_name ? { subtitle: e.client_display_name } : {}),
      });
      go(`/engagements/${e.id}`);
    },
    [go, isSearching, trimmed],
  );

  const openTemplate = useCallback(
    (tpl: TemplateHit) => {
      if (isSearching) recordSearch(trimmed);
      // Built-in templates 404 on the editor (it requires firm_id) — route them
      // to the gallery where they can be viewed and cloned.
      go(tpl.is_builtin ? "/templates" : `/templates/${tpl.id}`);
    },
    [go, isSearching, trimmed],
  );

  // A static registry entry: either navigate (most) or run an in-place action
  // (log out, switch theme). Recorded as a search so it shows under recents.
  const runEntry = useCallback(
    (entry: SearchEntry) => {
      if (isSearching) recordSearch(trimmed);
      if (entry.action) {
        close();
        switch (entry.action) {
          case "logout":
            void logoutAction();
            break;
          case "theme-dark":
            setTheme("dark");
            break;
          case "theme-light":
            setTheme("light");
            break;
          case "theme-system":
            setTheme("system");
            break;
        }
        return;
      }
      if (entry.href) go(entry.href);
    },
    [isSearching, trimmed, close, go, setTheme],
  );

  const openRecentItem = useCallback(
    (item: RecentItem) => {
      recordItem(item); // re-promote to the front
      go(
        item.kind === "client"
          ? `/clients/${item.id}`
          : `/engagements/${item.id}`,
      );
    },
    [go],
  );

  const hasApiResults =
    results.clients.length > 0 ||
    results.engagements.length > 0 ||
    results.templates.length > 0;
  const hasEntryMatches = goMatches.length > 0 || actionMatches.length > 0;
  const showNoResults =
    isSearching && !loading && !hasApiResults && !hasEntryMatches;
  const hasRecents = recentSearches.length > 0 || recentItems.length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[420ms] data-[state=open]:ease-[cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in" />
        <DialogPrimitive.Content
          aria-label={t("title")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          style={
            anchor
              ? { left: anchor.left, top: anchor.top, width: anchor.width }
              : undefined
          }
          className="fixed z-50 origin-top-left outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=open]:duration-[420ms] data-[state=open]:ease-[cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-200 data-[state=closed]:ease-[cubic-bezier(0.4,0,0.2,1)]"
        >
          <DialogPrimitive.Title className="sr-only">
            {t("title")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("placeholder")}
          </DialogPrimitive.Description>

          <div className="overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5">
            <Command
              shouldFilter={false}
              loop
              label={t("title")}
              className="focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              {/* Input row */}
              <div className="flex items-center gap-2.5 border-b border-border/60 px-4">
                <Search
                  className="size-[18px] shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <CommandPrimitive.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t("placeholder")}
                  className="h-12 w-full bg-transparent text-sm outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
                />
                <kbd className="pointer-events-none hidden shrink-0 select-none rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
                  Esc
                </kbd>
              </div>

              <CommandList className="max-h-[min(60vh,420px)] px-2 py-2 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                {isSearching ? (
                  <>
                    {goMatches.length > 0 && (
                      <CommandGroup heading={t("group_go")}>
                        {goMatches.map((entry) => {
                          const Icon = entry.icon;
                          return (
                            <NavRow
                              key={`go:${entry.id}`}
                              value={`go:${entry.id}`}
                              label={entry.label}
                              onSelect={() => runEntry(entry)}
                              icon={
                                <Icon
                                  className={cn("size-4", entry.color)}
                                  aria-hidden
                                />
                              }
                            />
                          );
                        })}
                      </CommandGroup>
                    )}
                    {actionMatches.length > 0 && (
                      <CommandGroup heading={t("group_actions")}>
                        {actionMatches.map((entry) => {
                          const Icon = entry.icon;
                          return (
                            <NavRow
                              key={`action:${entry.id}`}
                              value={`action:${entry.id}`}
                              label={entry.label}
                              onSelect={() => runEntry(entry)}
                              icon={
                                <Icon
                                  className={cn("size-4", entry.color)}
                                  aria-hidden
                                />
                              }
                            />
                          );
                        })}
                      </CommandGroup>
                    )}
                    {results.clients.length > 0 && (
                      <CommandGroup heading={t("clients")}>
                        {results.clients.map((c) => (
                          <ResultRow
                            key={c.id}
                            value={`client:${c.id}`}
                            title={c.display_name}
                            subtitle={c.email ?? undefined}
                            onSelect={() => openClient(c)}
                            icon={
                              <Users
                                className="size-4 text-icon-emerald"
                                aria-hidden
                              />
                            }
                          />
                        ))}
                      </CommandGroup>
                    )}
                    {results.engagements.length > 0 && (
                      <CommandGroup heading={t("engagements")}>
                        {results.engagements.map((e) => (
                          <ResultRow
                            key={e.id}
                            value={`eng:${e.id}`}
                            title={e.title}
                            subtitle={e.client_display_name ?? undefined}
                            onSelect={() => openEngagement(e)}
                            icon={
                              <Briefcase
                                className="size-4 text-icon-blue"
                                aria-hidden
                              />
                            }
                          />
                        ))}
                      </CommandGroup>
                    )}
                    {results.templates.length > 0 && (
                      <CommandGroup heading={t("templates")}>
                        {results.templates.map((tpl) => (
                          <ResultRow
                            key={tpl.id}
                            value={`tpl:${tpl.id}`}
                            title={tpl.name}
                            onSelect={() => openTemplate(tpl)}
                            icon={
                              <FileText
                                className="size-4 text-icon-amber"
                                aria-hidden
                              />
                            }
                          />
                        ))}
                      </CommandGroup>
                    )}
                    {loading && !hasApiResults && (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t("searching")}
                      </p>
                    )}
                    {showNoResults && (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t("no_results")}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {recentSearches.length > 0 && (
                      <CommandGroup heading={t("recent_searches")}>
                        {recentSearches.map((s) => (
                          <NavRow
                            key={s}
                            value={`search:${s}`}
                            label={s}
                            onSelect={() => setQuery(s)}
                            icon={
                              <Clock
                                className="size-4 text-muted-foreground"
                                aria-hidden
                              />
                            }
                          />
                        ))}
                      </CommandGroup>
                    )}
                    {recentItems.length > 0 && (
                      <CommandGroup heading={t("recently_visited")}>
                        {recentItems.map((it) => (
                          <ResultRow
                            key={`${it.kind}:${it.id}`}
                            value={`recent:${it.kind}:${it.id}`}
                            title={it.title}
                            subtitle={it.subtitle}
                            onSelect={() => openRecentItem(it)}
                            icon={
                              it.kind === "client" ? (
                                <Users
                                  className="size-4 text-icon-emerald"
                                  aria-hidden
                                />
                              ) : (
                                <Briefcase
                                  className="size-4 text-icon-blue"
                                  aria-hidden
                                />
                              )
                            }
                          />
                        ))}
                      </CommandGroup>
                    )}
                    <CommandGroup heading={t("jump_to")}>
                      {primaryDestinations.map((entry) => {
                        const Icon = entry.icon;
                        return (
                          <NavRow
                            key={entry.id}
                            value={`go:${entry.id}`}
                            label={entry.label}
                            onSelect={() => runEntry(entry)}
                            icon={
                              <Icon
                                className={cn("size-4", entry.color)}
                                aria-hidden
                              />
                            }
                          />
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </CommandList>

              {/* Footer hints */}
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
                <div className="hidden items-center gap-3 sm:flex">
                  <span className="inline-flex items-center gap-1">
                    <Kbd>
                      <ArrowUp className="size-3" aria-hidden />
                    </Kbd>
                    <Kbd>
                      <ArrowDown className="size-3" aria-hidden />
                    </Kbd>
                    {t("hint_navigate")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>
                      <CornerDownLeft className="size-3" aria-hidden />
                    </Kbd>
                    {t("hint_open")}
                  </span>
                </div>
                {hasRecents && !isSearching && (
                  <button
                    type="button"
                    // mousedown so cmdk's pointer handling doesn't steal it
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearRecents();
                      refreshRecents();
                    }}
                    className="ml-auto rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t("clear")}
                  </button>
                )}
              </div>
            </Command>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NavRow({
  value,
  label,
  icon,
  onSelect,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      className="cursor-pointer gap-2.5 px-2.5 py-2.5"
    >
      {icon}
      <span className="truncate">{label}</span>
    </CommandItem>
  );
}

function ResultRow({
  value,
  title,
  subtitle,
  icon,
  onSelect,
}: {
  value: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      className="cursor-pointer gap-2.5 px-2.5 py-2"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary/60">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </CommandItem>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/70 bg-muted px-1 text-[10px] font-medium">
      {children}
    </kbd>
  );
}
