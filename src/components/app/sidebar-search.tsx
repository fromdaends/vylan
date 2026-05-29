"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Search, X, Users, Briefcase } from "lucide-react";

// Sidebar global search. Same surface as the Home search, but available
// on every app page. Unlike Home (which filters a preloaded in-memory
// index), this hits /api/search on each keystroke so the layout doesn't
// have to ship every client + engagement into every page.
//
// Keyboard: ArrowUp/Down move the highlight, Enter opens the highlighted
// row (or falls through to /clients?q=<query>), Escape closes.

type ClientHit = { id: string; display_name: string; email: string | null };
type EngagementHit = {
  id: string;
  title: string;
  client_id: string;
  client_display_name: string | null;
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 180;

export function SidebarSearch() {
  const t = useTranslations("Home");
  const router = useRouter();

  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    clients: ClientHit[];
    engagements: EngagementHit[];
  }>({ clients: [], engagements: [] });
  const [highlight, setHighlight] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();

  // Debounced fetch to /api/search. Previous results stay visible while
  // the next request is in flight (the dropdown refines as you type), an
  // AbortController drops stale responses, and `loading` flips on so a
  // fresh search never flashes "no results" before it has run.
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) return;
    setLoading(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
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
        setHighlight(-1);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setResults({ clients: [], engagements: [] });
          setHighlight(-1);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed]);

  // Flat list the keyboard nav walks, in render order (clients then
  // engagements).
  const flat: (
    | { kind: "client"; row: ClientHit }
    | { kind: "engagement"; row: EngagementHit }
  )[] = [
    ...results.clients.map((row) => ({ kind: "client" as const, row })),
    ...results.engagements.map((row) => ({ kind: "engagement" as const, row })),
  ];

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  const clear = useCallback(() => {
    setValue("");
    close();
    inputRef.current?.focus();
  }, [close]);

  const navigateTo = useCallback(
    (
      item:
        | { kind: "client"; row: ClientHit }
        | { kind: "engagement"; row: EngagementHit },
    ) => {
      if (item.kind === "client") router.push(`/clients/${item.row.id}`);
      else router.push(`/engagements/${item.row.id}`);
      close();
    },
    [router, close],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (highlight >= 0 && flat[highlight]) {
      navigateTo(flat[highlight]);
      return;
    }
    if (!trimmed) return;
    router.push(`/clients?q=${encodeURIComponent(trimmed)}`);
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? flat.length - 1 : h - 1));
    }
  }

  const canShowDropdown = trimmed.length >= MIN_CHARS && open;
  const hasResults =
    results.clients.length > 0 || results.engagements.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <form onSubmit={onSubmit}>
        <label htmlFor="sidebar-search" className="sr-only">
          {t("search_label")}
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          id="sidebar-search"
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(e.target.value.trim().length >= MIN_CHARS);
          }}
          onFocus={() => {
            if (trimmed.length >= MIN_CHARS) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("search_placeholder")}
          autoComplete="off"
          className="h-9 pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={canShowDropdown}
          aria-controls="sidebar-search-listbox"
          aria-activedescendant={
            highlight >= 0 ? `sidebar-search-opt-${highlight}` : undefined
          }
          aria-label={t("search_label")}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            aria-label={t("search_clear")}
            className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </form>

      {canShowDropdown && (
        <div
          id="sidebar-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-lg"
        >
          {!hasResults ? (
            loading ? null : (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("search_no_results")}
              </div>
            )
          ) : (
            <div className="py-1">
              {results.clients.length > 0 && (
                <SearchGroup
                  label={t("search_group_clients")}
                  icon={<Users className="h-3 w-3 text-muted-foreground/70" aria-hidden />}
                >
                  {results.clients.map((c, i) => (
                    <SearchRow
                      key={c.id}
                      id={`sidebar-search-opt-${i}`}
                      active={highlight === i}
                      onMouseEnter={() => setHighlight(i)}
                      onSelect={() => navigateTo({ kind: "client", row: c })}
                      title={c.display_name}
                      subtitle={c.email ?? undefined}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.engagements.length > 0 && (
                <SearchGroup
                  label={t("search_group_engagements")}
                  icon={<Briefcase className="h-3 w-3 text-muted-foreground/70" aria-hidden />}
                >
                  {results.engagements.map((e, i) => {
                    const idx = results.clients.length + i;
                    return (
                      <SearchRow
                        key={e.id}
                        id={`sidebar-search-opt-${idx}`}
                        active={highlight === idx}
                        onMouseEnter={() => setHighlight(idx)}
                        onSelect={() =>
                          navigateTo({ kind: "engagement", row: e })
                        }
                        title={e.title}
                        subtitle={e.client_display_name ?? undefined}
                      />
                    );
                  })}
                </SearchGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {icon}
        {label}
      </div>
      <ul role="group">{children}</ul>
    </div>
  );
}

function SearchRow({
  id,
  active,
  onMouseEnter,
  onSelect,
  title,
  subtitle,
}: {
  id: string;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <li>
      <button
        id={id}
        role="option"
        aria-selected={active}
        type="button"
        onMouseEnter={onMouseEnter}
        // mousedown (not click) so the outside-click handler — which also
        // fires on mousedown — doesn't close the dropdown first.
        onMouseDown={(e) => {
          e.preventDefault();
          onSelect();
        }}
        className={
          "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors " +
          (active ? "bg-secondary/60" : "hover:bg-secondary/40")
        }
      >
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </button>
    </li>
  );
}
