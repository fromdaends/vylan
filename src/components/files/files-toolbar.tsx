"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  FileType2,
  Info,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { BROWSE_CATEGORIES } from "@/lib/files/axes";

// Search debounce. Long enough that typing a client name is one query rather
// than twelve, short enough that it still feels live. This search is SERVER
// side (the spec's requirement — the firm's whole document set is far too big
// to filter in the browser the way the Clients page does), so every keystroke
// that gets through is a real round-trip.
const DEBOUNCE_MS = 300;

export function FilesToolbar({
  search,
  sort,
  docType,
  status,
  year,
  years,
  docTypes,
  // What the search box is actually searching right now. At the top level with
  // nothing else applied it filters CLIENT FOLDERS by name; anywhere else it
  // searches documents. Two search boxes would have been worse — this is one
  // box that says what it does.
  scope,
}: {
  search: string;
  sort: string;
  docType: string;
  status: string;
  year: string;
  years: number[];
  docTypes: { code: string; label: string }[];
  scope: "folders" | "documents";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Files");

  const [query, setQuery] = useState(search);
  // Tracks what the URL currently holds so the debounce can tell "the user
  // typed" from "the page navigated". Without it, going back/forward or
  // clicking a folder would re-fire the previous search term.
  const committed = useRef(search);
  const [syncedSearch, setSyncedSearch] = useState(search);

  // Re-sync the box when the URL changes underneath us (back/forward, or
  // clearing a filter). Done DURING RENDER rather than in an effect — React's
  // documented pattern for adjusting state when a prop changes. The effect
  // version renders once with the stale value and then immediately again,
  // which is both a wasted pass and what the lint rule is warning about.
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setQuery(search);
    committed.current = search;
  }

  useEffect(() => {
    if (query === committed.current) return;
    const id = setTimeout(() => {
      committed.current = query;
      setParam("q", query || null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // setParam is stable for our purposes (router/pathname/params identities
    // only change on navigation, which also resets `query` above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    // Any change to what is being listed invalidates the page number. Leaving
    // it behind strands the user on "page 4" of a 2-page result and shows them
    // an empty table.
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            scope === "folders"
              ? t("search_clients_placeholder")
              : t("search_documents_placeholder")
          }
          aria-label={
            scope === "folders"
              ? t("search_clients_placeholder")
              : t("search_documents_placeholder")
          }
          className="w-full pl-8 sm:w-80"
        />
        {pending && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70"
            aria-hidden
          >
            …
          </span>
        )}
      </div>
      {/* What the search can and cannot see. Content search only covers
          documents the AI has read (new portal uploads — capture is
          forward-only by the founder's ruling), and without saying so the
          honest gap reads as "search is broken" the first time a word inside
          an old file comes up empty. */}
      {scope === "documents" && (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("search_scope_hint")}
                className="-ml-2 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72">
              {t("search_scope_hint")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {scope === "documents" && (
        <SortFilterMenu
          sort={sort}
          docType={docType}
          status={status}
          year={year}
          years={years}
          docTypes={docTypes}
          setParam={setParam}
        />
      )}
    </div>
  );
}

/**
 * ONE button — Sort. The founder's ruling, verbatim: "just move all of that
 * into sort - SIMPLE. one button - sort." So the menu carries everything the
 * list can be arranged by: "Sort by" and "Sort direction" inline (exactly
 * Drive's menu), and the type / year / status filters as submenus of the
 * same button. The toolbar is a search box and this.
 *
 * URL values keep their history: bare "name"/"size"/default-date mean what
 * they always meant, and the other direction gets a suffixed value — so old
 * links and the Home tab's "View all" keep working unchanged.
 */
function SortFilterMenu({
  sort,
  docType,
  status,
  year,
  years,
  docTypes,
  setParam,
}: {
  sort: string;
  docType: string;
  status: string;
  year: string;
  years: number[];
  docTypes: { code: string; label: string }[];
  setParam: (key: string, value: string | null) => void;
}) {
  const t = useTranslations("Files");
  const field = sort.startsWith("name")
    ? "name"
    : sort.startsWith("size")
      ? "size"
      : "date";
  const ascending =
    sort === "name" || sort === "date_asc" || sort === "size_asc";

  function paramFor(nextField: string, nextAsc: boolean): string | null {
    if (nextField === "name") return nextAsc ? "name" : "name_desc";
    if (nextField === "size") return nextAsc ? "size_asc" : "size";
    return nextAsc ? "date_asc" : null; // newest-first date is the default URL
  }

  // Switching FIELD keeps Drive's sensible per-field default direction
  // (names A→Z, dates newest, sizes largest) instead of dragging the old
  // direction along; switching DIRECTION keeps the field.
  function defaultAscFor(nextField: string): boolean {
    return nextField === "name";
  }

  const fields = [
    { key: "name", label: t("sort_field_name") },
    { key: "date", label: t("sort_field_date") },
    { key: "size", label: t("sort_field_size") },
  ];

  // Applied FILTERS surface on the button as a count — with the dropdowns
  // gone, an invisible active filter would read as "my files disappeared".
  const activeFilters = [docType, year, status].filter(Boolean).length;

  const check = (on: boolean) => (
    <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} aria-hidden />
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
          {t("sort_button")}
          {activeFilters > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {activeFilters}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("sort_by")}
        </DropdownMenuLabel>
        {fields.map((f) => (
          <DropdownMenuItem
            key={f.key}
            className="gap-2"
            onSelect={() => setParam("sort", paramFor(f.key, defaultAscFor(f.key)))}
          >
            {check(field === f.key)}
            {f.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("sort_direction")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => setParam("sort", paramFor(field, true))}
        >
          {check(ascending)}
          {t("sort_az")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => setParam("sort", paramFor(field, false))}
        >
          {check(!ascending)}
          {t("sort_za")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <FileType2 className="size-4 text-muted-foreground" aria-hidden />
            {t("filter_type")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuItem className="gap-2" onSelect={() => setParam("type", null)}>
              {check(!docType)}
              {t("filter_type_all")}
            </DropdownMenuItem>
            {docTypes.map((d) => (
              <DropdownMenuItem
                key={d.code}
                className="gap-2"
                onSelect={() => setParam("type", d.code)}
              >
                {check(docType === d.code)}
                {d.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            {t("filter_year")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-44 overflow-y-auto">
            <DropdownMenuItem className="gap-2" onSelect={() => setParam("year", null)}>
              {check(!year)}
              {t("filter_year_all")}
            </DropdownMenuItem>
            {years.map((y) => (
              <DropdownMenuItem
                key={y}
                className="gap-2"
                onSelect={() => setParam("year", String(y))}
              >
                {check(year === String(y))}
                {y}
              </DropdownMenuItem>
            ))}
            {/* "unsorted" is a real, selectable bucket, not the absence of a
                filter — a firm needs to be able to go straight to the pile
                that still needs a year. */}
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => setParam("year", "unsorted")}
            >
              {check(year === "unsorted")}
              {t("unsorted")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            {t("filter_status")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuItem className="gap-2" onSelect={() => setParam("status", null)}>
              {check(!status)}
              {t("filter_status_all")}
            </DropdownMenuItem>
            {(["approved", "pending", "rejected"] as const).map((s) => (
              <DropdownMenuItem
                key={s}
                className="gap-2"
                onSelect={() => setParam("status", s)}
              >
                {check(status === s)}
                {t(`status_${s}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Category codes, exported so the page can validate a ?category= value. */
export { BROWSE_CATEGORIES };
