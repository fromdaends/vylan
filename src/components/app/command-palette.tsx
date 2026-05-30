"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslations } from "next-intl";
import {
  Search,
  Clock,
  Users,
  Briefcase,
  LayoutDashboard,
  Inbox,
  FileText,
  Settings,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/cn";
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
// destinations; once you type it streams live results from /api/search.

export const COMMAND_PALETTE_EVENT = "vylan:command-palette";

type ClientHit = { id: string; display_name: string; email: string | null };
type EngagementHit = {
  id: string;
  title: string;
  client_id: string;
  client_display_name: string | null;
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 180;

export function CommandPalette() {
  const t = useTranslations("CommandPalette");
  const tNav = useTranslations("App");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    clients: ClientHit[];
    engagements: EngagementHit[];
  }>({ clients: [], engagements: [] });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  const trimmed = query.trim();
  const isSearching = trimmed.length >= MIN_CHARS;

  const navDestinations = [
    {
      href: "/dashboard",
      label: tNav("nav_dashboard"),
      icon: LayoutDashboard,
      color: "text-icon-blue",
    },
    { href: "/inbox", label: tNav("nav_inbox"), icon: Inbox, color: "text-icon-indigo" },
    {
      href: "/clients",
      label: tNav("nav_clients"),
      icon: Users,
      color: "text-icon-emerald",
    },
    {
      href: "/templates",
      label: tNav("nav_templates"),
      icon: FileText,
      color: "text-icon-amber",
    },
    {
      href: "/settings",
      label: tNav("nav_settings"),
      icon: Settings,
      color: "text-icon-cyan",
    },
  ];

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
        refreshRecents();
      } else {
        setQuery("");
        setResults({ clients: [], engagements: [] });
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
          ? ((await res.json()) as {
              clients?: ClientHit[];
              engagements?: EngagementHit[];
            })
          : { clients: [], engagements: [] };
        setResults({
          clients: data.clients ?? [],
          engagements: data.engagements ?? [],
        });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setResults({ clients: [], engagements: [] });
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

  const matchingPages = isSearching
    ? navDestinations.filter((d) =>
        d.label.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : [];

  const hasApiResults =
    results.clients.length > 0 || results.engagements.length > 0;
  const showNoResults =
    isSearching && !loading && !hasApiResults && matchingPages.length === 0;
  const hasRecents = recentSearches.length > 0 || recentItems.length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label={t("title")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-[14vh] z-50 w-full max-w-[640px] -translate-x-1/2 px-4 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            {t("title")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("placeholder")}
          </DialogPrimitive.Description>

          <div className="overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5">
            <Command shouldFilter={false} loop label={t("title")}>
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
                  className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
                <kbd className="pointer-events-none hidden shrink-0 select-none rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
                  Esc
                </kbd>
              </div>

              <CommandList className="max-h-[min(60vh,420px)] px-2 py-2">
                {isSearching ? (
                  <>
                    {matchingPages.length > 0 && (
                      <CommandGroup heading={t("pages")}>
                        {matchingPages.map((d) => {
                          const Icon = d.icon;
                          return (
                            <NavRow
                              key={d.href}
                              value={`nav:${d.href}`}
                              label={d.label}
                              onSelect={() => go(d.href)}
                              icon={
                                <Icon
                                  className={cn("size-4", d.color)}
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
                      {navDestinations.map((d) => {
                        const Icon = d.icon;
                        return (
                          <NavRow
                            key={d.href}
                            value={`nav:${d.href}`}
                            label={d.label}
                            onSelect={() => go(d.href)}
                            icon={
                              <Icon
                                className={cn("size-4", d.color)}
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
