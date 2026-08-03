"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

// THE FILES HEADER SEARCH — one search box for the whole section.
//
// It lives in the PAGE HEADER rather than inside Browse's toolbar, and typing
// in it switches to Browse and filters the level you are on. That is the
// redesign's one behavioural claim about search: you should never have to find
// the right tab before you can look something up.
//
// URL-as-state, like the rest of /files: the query is written to ?q= (with
// ?tab=browse so a search from Home lands somewhere that can show results), so
// a search is linkable, survives a reload, and needs no client-side store. The
// input keeps its own value between keystrokes so it never lags the typist
// while the server round-trips.

/** How long the field sits still before the URL is rewritten. Long enough that
 * a normal typing burst is ONE navigation, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function FilesHeaderSearch() {
  const t = useTranslations("Files");
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";

  const [value, setValue] = useState(urlQuery);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What we last WROTE to the URL. Without it, the effect below treats our own
  // navigation as an external change and fights the user's next keystroke.
  const written = useRef(urlQuery);

  // Follow the URL when it changes underneath us — a back/forward, or a link
  // that clears the search. Our own writes are ignored via `written`.
  useEffect(() => {
    if (urlQuery !== written.current) {
      written.current = urlQuery;
      setValue(urlQuery);
    }
  }, [urlQuery]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function commit(next: string) {
    const sp = new URLSearchParams(params.toString());
    const trimmed = next.trim();

    if (trimmed) sp.set("q", trimmed);
    else sp.delete("q");

    // Searching means Browse. Home has no result list to filter, so a query
    // typed there would otherwise vanish into a tab that cannot show it.
    sp.set("tab", "browse");
    // A new query starts at page one — staying on page 4 of the previous
    // search reliably shows an empty list and reads as "no results".
    sp.delete("page");

    written.current = trimmed;
    startTransition(() => {
      router.replace(`/files?${sp.toString()}`);
    });
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          // Enter commits immediately rather than waiting out the debounce.
          if (e.key === "Enter") {
            if (timer.current) clearTimeout(timer.current);
            commit(value);
          }
        }}
        placeholder={t("search_all_placeholder")}
        aria-label={t("search_all_placeholder")}
        className="h-[42px] w-full rounded-[11px] border border-border bg-card pr-3.5 pl-9 text-sm text-foreground shadow-[0_1px_2px_rgba(10,10,20,0.03)] transition-colors placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-[340px]"
      />
    </div>
  );
}
