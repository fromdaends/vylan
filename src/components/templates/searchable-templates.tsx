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
// ── THE LAYOUT IS CANOPY'S, FROM THE FOUNDER'S SCREENSHOT ──────────────────
//
// Their template list is one bordered card containing, in this order:
//
//   Team | Private | Drafts        <- tabs, inside the card
//   [ search ]                     <- search, inside the card, under the tabs
//   rows...
//
// The search used to sit up in the page header. It moved because the founder
// sent that screenshot and asked for this shape: the search belongs to the LIST
// it filters, and a header that carries a title, a subtitle, a button and a
// search box is doing four jobs.
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

      {filtered.map((s) => {
        const isPrimary = s.key === primaryKey;
        // While searching, a NON-primary section with no hits is dropped
        // entirely rather than showing its "you have none yet" state — which
        // would be a lie about the section, not an answer about the search.
        if (q && !isPrimary && s.cards.length === 0) return null;

        return (
          <section
            key={s.key}
            className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
          >
            {isPrimary ? (
              <>
                {hasTabs && (
                <div
                  role="tablist"
                  aria-label={title}
                  className="flex items-center border-b border-border/70"
                >
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
                          "relative flex-1 border-b-2 px-4 py-3 text-sm transition-colors",
                          active
                            ? "border-accent font-semibold text-foreground"
                            : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(TAB_LABEL[key])}
                        <span className="ml-1.5 font-mono text-xs tabular-nums text-muted-foreground/70">
                          {countFor(key)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                )}
                {/* The search belongs to the primary list whether or not it has
                    tabs — a page with no team/private split still needs to be
                    searchable. */}
                <div className="relative border-b border-border/70">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("search_placeholder")}
                    aria-label={t("search_placeholder")}
                    className="h-11 w-full bg-transparent pr-4 pl-11 text-sm text-foreground placeholder:text-muted-foreground/75 focus-visible:outline-none"
                  />
                </div>
              </>
            ) : (
              <div className="border-b border-border/70 px-[18px] py-3">
                <h2 className="text-sm font-semibold">{s.title}</h2>
              </div>
            )}

            <div className="p-3">
              {nothingMatches && isPrimary ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm font-medium">
                    {t("no_matches", { query })}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
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
            </div>
          </section>
        );
      })}
    </>
  );
}
