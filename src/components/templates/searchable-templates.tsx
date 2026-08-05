"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  CardGrid,
  TemplatesPageHeader,
  TemplatesSection,
} from "./templates-chrome";

// Search over a Templates page's cards.
//
// It has to own the HEADER as well as the grid: the input lives in the header
// per the handoff, and it filters an already-loaded list on every keystroke, so
// the two cannot sit in different components without a store between them. The
// chrome pieces are a plain module (no "use client", no server-only imports),
// so a client component can render them directly — which is why this needs no
// second copy of the header.
//
// Cards arrive as ALREADY-RENDERED nodes with a `terms` string beside each.
// The server builds them, keeping its server actions inside real <form>s, and
// this component never has to know what a template is.

export type SearchableCard = {
  id: string;
  /** Everything this card should be findable by — name plus its contents. */
  terms: string;
  node: ReactNode;
};

export type SearchableSection = {
  key: string;
  title: string;
  cards: SearchableCard[];
  /** Shown instead of the grid when this section has nothing at all — as
   * opposed to nothing MATCHING, which the whole page answers once below. */
  empty?: ReactNode;
};

export function SearchableTemplates({
  title,
  subtitle,
  action,
  sections,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  sections: SearchableSection[];
}) {
  const t = useTranslations("Templates");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sections.map((s) => ({
        ...s,
        cards: q ? s.cards.filter((c) => c.terms.toLowerCase().includes(q)) : s.cards,
      })),
    [sections, q],
  );
  // Only meaningful while searching: with no query, an empty page is the
  // sections' own empty states, which say something more useful.
  const nothingMatches = q !== "" && filtered.every((s) => s.cards.length === 0);

  return (
    <>
      <TemplatesPageHeader
        title={title}
        subtitle={subtitle}
        action={action}
        search={
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_placeholder")}
              className="h-[42px] w-full rounded-[11px] border border-border bg-card pr-3.5 pl-9 text-sm text-foreground shadow-[0_1px_2px_rgba(10,10,20,0.03)] transition-colors placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-[300px]"
            />
          </div>
        }
      />

      {nothingMatches ? (
        <div className="rounded-xl border border-border/70 bg-card px-6 py-14 text-center">
          <p className="text-sm font-medium">{t("no_matches", { query })}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("no_matches_hint")}
          </p>
        </div>
      ) : (
        filtered.map((s) => {
          // While searching, a section with no hits is dropped entirely rather
          // than showing its "you have none yet" card — which would be a lie
          // about the section, not an answer about the search.
          if (q && s.cards.length === 0) return null;
          return (
            <TemplatesSection key={s.key} title={s.title} count={s.cards.length}>
              {s.cards.length === 0 && s.empty ? (
                s.empty
              ) : (
                <CardGrid>{s.cards.map((c) => c.node)}</CardGrid>
              )}
            </TemplatesSection>
          );
        })
      )}
    </>
  );
}
