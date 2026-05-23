"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Search, X, Users, Briefcase } from "lucide-react";

// Home-page search input with live typeahead dropdown.
//
// Enter still routes to /clients?q=<query> exactly as before — that
// flow is intentionally preserved so power-users keep their muscle
// memory. The new behavior is layered on top: typing 2+ chars opens
// a dropdown of matching clients and engagements pulled from
// /api/search, debounced ~200ms. Clicking a row navigates directly
// to that item.
//
// Keyboard nav (nice-to-have, kept simple):
//   - ArrowDown / ArrowUp : move highlight through the flat list
//                            of results (clients then engagements).
//   - Enter on a highlighted row : navigate to that row.
//   - Enter with nothing highlighted : fall through to the existing
//                            /clients?q= behavior.
//   - Escape : close the dropdown.
//
// Outside-click and the inline (X) clear button both close the
// dropdown and reset state.

type ClientHit = {
  id: string;
  display_name: string;
  email: string | null;
};

type EngagementHit = {
  id: string;
  title: string;
  client_id: string;
  client_display_name: string | null;
};

type SearchResponse = {
  clients: ClientHit[];
  engagements: EngagementHit[];
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

export function HomeSearch() {
  const t = useTranslations("Home");
  const router = useRouter();

  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResponse>({
    clients: [],
    engagements: [],
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks the in-flight fetch so a stale response doesn't overwrite
  // a newer one (user types "tre" → "trem" → trem arrives first if
  // its query is faster; the tre response is discarded).
  const reqIdRef = useRef(0);

  // Flat list the keyboard nav walks. Clients first, then engagements
  // — same order they render. Memoized so re-renders during arrow-
  // key movement don't rebuild it.
  const flat = useMemo(() => {
    const out: (
      | { kind: "client"; row: ClientHit }
      | { kind: "engagement"; row: EngagementHit }
    )[] = [];
    for (const c of results.clients) out.push({ kind: "client", row: c });
    for (const e of results.engagements) out.push({ kind: "engagement", row: e });
    return out;
  }, [results]);

  // Debounced fetch. Cleared on every keystroke + on unmount.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults({ clients: [], engagements: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        if (myReq !== reqIdRef.current) return; // stale
        if (res.ok) {
          const data = (await res.json()) as SearchResponse;
          setResults(data);
        } else {
          setResults({ clients: [], engagements: [] });
        }
      } catch {
        if (myReq !== reqIdRef.current) return;
        setResults({ clients: [], engagements: [] });
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  // Reset the highlight whenever the result set changes so the user
  // doesn't land on an index that no longer exists.
  useEffect(() => {
    setHighlight(-1);
  }, [results]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
    setResults({ clients: [], engagements: [] });
    close();
    inputRef.current?.focus();
  }, [close]);

  function navigateTo(
    row: { kind: "client"; row: ClientHit } | { kind: "engagement"; row: EngagementHit },
  ) {
    if (row.kind === "client") {
      router.push(`/clients/${row.row.id}`);
    } else {
      router.push(`/engagements/${row.row.id}`);
    }
    close();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // If the user has highlighted a row with arrow keys, Enter selects
    // that row. Otherwise fall through to the original "go to the
    // clients page filtered by q" behavior.
    if (highlight >= 0 && flat[highlight]) {
      navigateTo(flat[highlight]);
      return;
    }
    const q = value.trim();
    if (!q) return;
    router.push(`/clients?q=${encodeURIComponent(q)}`);
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

  // The dropdown is open whenever the user is actively in the
  // typeahead state: focused on the input AND has typed >= MIN_CHARS.
  const trimmed = value.trim();
  const canShowDropdown = trimmed.length >= MIN_CHARS && open;
  const hasResults =
    results.clients.length > 0 || results.engagements.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <form onSubmit={onSubmit}>
        <label htmlFor="home-search" className="sr-only">
          {t("search_label")}
        </label>
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 pointer-events-none"
          aria-hidden
        />
        <Input
          ref={inputRef}
          id="home-search"
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim().length >= MIN_CHARS) setOpen(true);
            else setOpen(false);
          }}
          onFocus={() => {
            if (trimmed.length >= MIN_CHARS) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("search_placeholder")}
          autoComplete="off"
          // Hide the native "search input" X — we render our own to
          // make sure it ALSO clears the dropdown state, not just the
          // text in the input.
          className="pl-11 pr-10 h-12 text-base rounded-full bg-card/60 border-border/60 shadow-sm focus-visible:border-foreground/30 focus-visible:ring-foreground/10 [&::-webkit-search-cancel-button]:hidden"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={canShowDropdown}
          aria-controls="home-search-listbox"
          aria-activedescendant={
            highlight >= 0 ? `home-search-opt-${highlight}` : undefined
          }
          aria-label={t("search_label")}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            aria-label={t("search_clear")}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </form>

      {canShowDropdown && (
        <div
          id="home-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg overflow-hidden"
        >
          {!hasResults ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {loading ? t("search_loading") : t("search_no_results")}
            </div>
          ) : (
            <div className="max-h-[24rem] overflow-y-auto py-1">
              {results.clients.length > 0 && (
                <SearchGroup
                  label={t("search_group_clients")}
                  icon={
                    <Users
                      className="h-3 w-3 text-muted-foreground/70"
                      aria-hidden
                    />
                  }
                >
                  {results.clients.map((c, i) => {
                    const idx = i;
                    return (
                      <SearchRow
                        key={c.id}
                        id={`home-search-opt-${idx}`}
                        active={highlight === idx}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => navigateTo({ kind: "client", row: c })}
                        title={c.display_name}
                        subtitle={c.email ?? undefined}
                      />
                    );
                  })}
                </SearchGroup>
              )}
              {results.engagements.length > 0 && (
                <SearchGroup
                  label={t("search_group_engagements")}
                  icon={
                    <Briefcase
                      className="h-3 w-3 text-muted-foreground/70"
                      aria-hidden
                    />
                  }
                >
                  {results.engagements.map((e, i) => {
                    const idx = results.clients.length + i;
                    return (
                      <SearchRow
                        key={e.id}
                        id={`home-search-opt-${idx}`}
                        active={highlight === idx}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() =>
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
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 font-medium">
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
  onClick,
  title,
  subtitle,
}: {
  id: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
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
        // Use mousedown not click so the outside-click handler (which
        // also fires on mousedown) doesn't close the dropdown before
        // the click can register.
        onMouseDown={(e) => {
          e.preventDefault();
          onClick();
        }}
        className={
          "w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors " +
          (active ? "bg-secondary/60" : "hover:bg-secondary/40")
        }
      >
        <span className="text-sm font-medium truncate">{title}</span>
        {subtitle && (
          <span className="text-xs text-muted-foreground truncate">
            {subtitle}
          </span>
        )}
      </button>
    </li>
  );
}
