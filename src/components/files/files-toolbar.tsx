"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpDown, FileType2, Info, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
        <>
          <Select
            value={docType || "all"}
            onValueChange={(v) => setParam("type", v === "all" ? null : v)}
          >
            <SelectTrigger size="sm" className="w-[13rem]" aria-label={t("filter_type")}>
              <FileType2 className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("filter_type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter_type_all")}</SelectItem>
              {docTypes.map((d) => (
                <SelectItem key={d.code} value={d.code}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={year || "all"}
            onValueChange={(v) => setParam("year", v === "all" ? null : v)}
          >
            <SelectTrigger size="sm" className="w-[9rem]" aria-label={t("filter_year")}>
              <SelectValue placeholder={t("filter_year")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter_year_all")}</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
              {/* "unsorted" is a real, selectable bucket, not the absence of a
                  filter — a firm needs to be able to go straight to the pile
                  that still needs a year. */}
              <SelectItem value="unsorted">{t("unsorted")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status || "all"}
            onValueChange={(v) => setParam("status", v === "all" ? null : v)}
          >
            <SelectTrigger size="sm" className="w-[11rem]" aria-label={t("filter_status")}>
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("filter_status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter_status_all")}</SelectItem>
              <SelectItem value="approved">{t("status_approved")}</SelectItem>
              <SelectItem value="pending">{t("status_pending")}</SelectItem>
              <SelectItem value="rejected">{t("status_rejected")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sort || "date"}
            onValueChange={(v) => setParam("sort", v === "date" ? null : v)}
          >
            <SelectTrigger size="sm" className="w-[11rem]" aria-label={t("sort_label")}>
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("sort_label")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">{t("sort_date")}</SelectItem>
              <SelectItem value="name">{t("sort_name")}</SelectItem>
              <SelectItem value="size">{t("sort_size")}</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}

/** Category codes, exported so the page can validate a ?category= value. */
export { BROWSE_CATEGORIES };
