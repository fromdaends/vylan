"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { TemplatesPageHeader } from "./templates-chrome";
import { TemplateRowList } from "./template-row";
import { cn } from "@/lib/cn";

// The ONE list every kind of template renders in.
//
// ── WHAT IT IS ─────────────────────────────────────────────────────────────
//
// Built first for the document-request cards, then made the shared list when
// the founder asked for the Templates surface to stop being four unrelated
// screens. It takes ALREADY-RENDERED nodes plus a string to match them by, so
// the server keeps its server actions inside real <form>s and this component
// never has to know what a template is.
//
// ── THE LAYOUT ─────────────────────────────────────────────────────────────
//
//   Templates                                          [ + New template ]
//   One line saying what these are for.
//
//   (Team 4) (Private 1) (Drafts 2)              [ 🔍 Search templates… ]
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ ▤  Monthly bookkeeping · 3 services                            ⋯ │
//   ├──────────────────────────────────────────────────────────────────┤
//   │ ▤  T1 — Personal tax · 1 service                               ⋯ │
//   └──────────────────────────────────────────────────────────────────┘
//
// The tabs used to be full-width segments stretched across the top of the card
// and the search was a bar underneath them. Both were sized for their own
// importance rather than their job: three words and a number do not need a
// third of the screen each, and stretching them made a two-item filter look
// like the page's main navigation. They are PILLS now, top-left, the size of
// what they say — the design handoff's shape, and Canopy's.
//
// Counts still come from the UNFILTERED list. A tab says how many are behind
// it, not how many survived what you typed — otherwise every tab reads 0 the
// moment a search misses, and the page looks empty rather than filtered.
//
// Built-in templates (Canopy's own "Canopy Templates" block) render as their
// own card below, with no tabs — you cannot make a built-in private, so
// offering the tab would be a filter over a distinction that does not exist.

export type SearchableCard = {
  id: string;
  /** Everything this row should be findable by — name plus its contents. */
  terms: string;
  /**
   * Which tab it belongs under. Omitted on a list with no tabs (built-ins).
   * A DRAFT is only ever under Drafts, even though it also has an access
   * level — a half-written template showing up in Team would be exactly the
   * mistake the Drafts tab exists to prevent.
   */
  group?: TabName;
  node: ReactNode;
};

export type SearchableSection = {
  key: string;
  title: string;
  cards: SearchableCard[];
  /** Shown instead of the rows when this section has nothing at all — as
   *  opposed to nothing MATCHING, which the whole page answers once below. */
  empty?: ReactNode;
  /** Tabs + search ride on this section. Exactly one section should set it. */
  primary?: boolean;
};

type TabName = "team" | "private" | "draft";
// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently.
type TabKey = "tab_team" | "tab_private" | "tab_drafts";
const TAB_LABEL: Record<TabName, TabKey> = {
  team: "tab_team",
  private: "tab_private",
  draft: "tab_drafts",
};

export function SearchableTemplates({
  title,
  subtitle,
  action,
  sections,
  /**
   * Which tabs this list shows.
   *
   * A LIST, not a boolean, because the three do not always all apply. Document
   * requests have no access level at all, and task templates have no drafts —
   * rendering an always-empty "Drafts (0)" would be a filter over a
   * distinction that does not exist. Undefined means no tabs.
   */
  tabs,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  sections: SearchableSection[];
  tabs?: readonly TabName[];
}) {
  const t = useTranslations("Templates");
  const [query, setQuery] = useState("");
  const shownTabs = tabs ?? [];
  const hasTabs = shownTabs.length > 0;
  const [tab, setTab] = useState<TabName>(shownTabs[0] ?? "team");

  const q = query.trim().toLowerCase();

  // Which section carries the tabs and the search box. Falls back to the first,
  // so a caller that forgets to mark one still gets a usable page.
  const primaryKey = (sections.find((s) => s.primary) ?? sections[0])?.key;

  const filtered = useMemo(
    () =>
      sections.map((s) => {
        const isPrimary = s.key === primaryKey;
        let cards = s.cards;
        // Tabs only narrow the primary section, and only when its rows
        // actually declare a group.
        if (isPrimary && hasTabs) {
          cards = cards.filter((c) => (c.group ?? "team") === tab);
        }
        if (q) cards = cards.filter((c) => c.terms.toLowerCase().includes(q));
        return { ...s, cards };
      }),
    [sections, q, tab, primaryKey, hasTabs],
  );

  // Only meaningful while searching: with no query, an empty page is the
  // sections' own empty states, which say something more useful.
  const nothingMatches = q !== "" && filtered.every((s) => s.cards.length === 0);

  // Counts come from the UNFILTERED list so a tab always says how many are
  // behind it, not how many survived the current search.
  const primarySection = sections.find((s) => s.key === primaryKey);
  const countFor = (key: TabName) =>
    (primarySection?.cards ?? []).filter((c) => (c.group ?? "team") === key)
      .length;

  return (
    <>
      <TemplatesPageHeader title={title} subtitle={subtitle} action={action} />

      {/* ── CONTROLS ROW — pills left, search right ────────────────────────
          One row, both controls the size of their own content. `flex-1`
          between them rather than `justify-between`, so the search stays
          right-aligned on a page whose pills are missing entirely (document
          requests and services have no access split). */}
      <div className="-mt-1 flex flex-wrap items-center gap-2.5">
        {hasTabs && (
          <div role="tablist" aria-label={title} className="flex gap-1.5">
            {shownTabs.map((key) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setTab(key)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12.5px] transition-colors",
                    active
                      ? // No border on the active pill: the fill IS the state,
                        // and a border under it reads as a second, weaker one.
                        "border border-transparent bg-accent-subtle font-[550] text-accent"
                      : "border border-border bg-card font-medium text-muted-foreground hover:border-accent/50 hover:text-foreground",
                  )}
                >
                  {t(TAB_LABEL[key])}
                  <span className="text-[11.5px] tabular-nums opacity-65">
                    {countFor(key)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex-1" />
        {/* The search belongs to the list it filters, whether or not that list
            has tabs — a page with no team/private split still needs one. */}
        <div className="relative w-full sm:w-[250px]">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            aria-label={t("search_placeholder")}
            className="h-8 w-full rounded-lg border border-border bg-card pr-3 pl-8 text-[13px] text-foreground transition-shadow placeholder:text-muted-foreground/75 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] focus-visible:outline-none"
          />
        </div>
      </div>

      {filtered.map((s) => {
        const isPrimary = s.key === primaryKey;
        // While searching, a NON-primary section with no hits is dropped
        // entirely rather than showing its "you have none yet" state — which
        // would be a lie about the section, not an answer about the search.
        if (q && !isPrimary && s.cards.length === 0) return null;

        return (
          <section
            key={s.key}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            {/* Built-ins and other secondary blocks still announce themselves.
                The primary list does not: the page title already named it, and
                a header saying "Templates" under a heading saying "Templates"
                was the row of pixels nobody read. */}
            {!isPrimary && (
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">{s.title}</h2>
              </div>
            )}

            {nothingMatches && isPrimary ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-[550]">
                  {t("no_matches", { query })}
                </p>
                <p className="mx-auto mt-1.5 max-w-[44ch] text-[12.5px] leading-relaxed text-muted-foreground">
                  {t("no_matches_hint")}
                </p>
              </div>
            ) : s.cards.length === 0 ? (
              (s.empty ?? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {t("tab_empty")}
                </p>
              ))
            ) : (
              <TemplateRowList>{s.cards.map((c) => c.node)}</TemplateRowList>
            )}
          </section>
        );
      })}
    </>
  );
}
