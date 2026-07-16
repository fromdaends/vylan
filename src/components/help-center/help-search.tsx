"use client";

// The white search bubble that sits in the blue hero.
//
// Search is entirely client-side: the corpus is static text that shipped with
// the page, so a round-trip per keystroke would be slower and buy nothing. The
// index arrives pre-folded from the server (see buildSearchIndex), which keeps
// the per-keystroke work to folding one short query and running includes()
// over a few dozen strings.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import {
  searchArticles,
  type SearchRecord,
} from "@/content/help/registry";

export type HelpSearchStrings = {
  placeholder: string;
  label: string;
  clear: string;
  noResults: string;
  noResultsHint: string;
  contactCta: string;
};

const MAX_RESULTS = 8;

export function HelpSearch({
  index,
  s,
  contactHref,
}: {
  index: SearchRecord[];
  s: HelpSearchStrings;
  contactHref: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Keyboard cursor. -1 = nothing highlighted, so Enter falls through to the
  // first result rather than doing nothing.
  const [cursor, setCursor] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const listId = useId();

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    return searchArticles(index, trimmed).slice(0, MAX_RESULTS);
  }, [index, query]);

  const showPanel = open && query.trim().length > 0;

  // Click-away and Escape both close.
  useEffect(() => {
    if (!showPanel) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPanel]);

  const hrefFor = (r: SearchRecord) => `/help/${r.category}/${r.slug}`;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!showPanel || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? results.length - 1 : c - 1));
    } else if (e.key === "Enter") {
      // Enter with nothing highlighted takes the top hit — the thing someone
      // who typed and hit Enter without looking almost certainly wants.
      const target = results[cursor === -1 ? 0 : cursor];
      if (target) {
        e.preventDefault();
        setOpen(false);
        router.push(hrefFor(target));
      }
    }
  };

  return (
    <div className="vyh-search" ref={rootRef}>
      <div className="vyh-search-bubble">
        <svg
          className="vyh-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          ref={inputRef}
          className="vyh-search-input"
          type="search"
          role="combobox"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Retyping invalidates the highlight: the row under it is a
            // different article now. Reset here rather than in an effect
            // keyed on `query` — this is the only place query changes, and
            // the effect version cascades an extra render per keystroke.
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={s.placeholder}
          aria-label={s.label}
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          // The browser's own "search" clear button would sit next to ours.
          style={{ appearance: "none", WebkitAppearance: "none" }}
        />
        {query.length > 0 ? (
          <button
            type="button"
            className="vyh-search-clear"
            aria-label={s.clear}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div className="vyh-results" id={listId} role="listbox">
          {results.length === 0 ? (
            <div className="vyh-empty">
              <div>{s.noResults}</div>
              <div style={{ marginTop: 6 }}>
                {s.noResultsHint}{" "}
                <a href={contactHref}>{s.contactCta}</a>
              </div>
            </div>
          ) : (
            results.map((r, i) => (
              <Link
                key={`${r.category}/${r.slug}`}
                href={hrefFor(r)}
                className="vyh-result"
                role="option"
                aria-selected={i === cursor}
                data-active={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => setOpen(false)}
              >
                <div className="vyh-result-cat">{r.categoryTitle}</div>
                <div className="vyh-result-title">{r.title}</div>
                <div className="vyh-result-sum">{r.summary}</div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
