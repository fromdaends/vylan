// The help center registry: the one place that knows about both locales.
//
// LocaleContent is a mapped type over the manifest, so each locale MUST supply
// a meta block for every category and an article for every slug. Miss one and
// TypeScript fails the build. That's the whole point: "the French version is
// missing" should be something the compiler says, not something a visitor in
// Trois-Rivières finds.

import type { AppLocale } from "@/i18n/routing";
import { normalizeText, searchTerms } from "@/lib/text/normalize";
import {
  HELP_STRUCTURE,
  CATEGORY_SLUGS,
  type CategorySlug,
  type ArticleSlugOf,
} from "./manifest";
import {
  type HelpArticle,
  type HelpCategoryMeta,
  articleText,
  articleHeadings,
} from "./types";
import { EN } from "./en";
import { FR } from "./fr";

export type LocaleContent = {
  [C in CategorySlug]: {
    meta: HelpCategoryMeta;
    articles: { [A in ArticleSlugOf<C>]: HelpArticle };
  };
};

// PHASE 2 ONLY — French is allowed to lag while English is being drafted.
//
// The founder reviews the English before it gets translated, so there is a
// window where a slug exists in EN and not yet in FR. Rather than block that
// with the compiler, FR is typed Partial and every read below SKIPS what isn't
// translated: the French site simply doesn't list or link an article it can't
// show. It is never a 404 and never English text under a French heading.
//
// PHASE 3 FLIPS THIS BACK. When the translations land, change FR's type in
// src/content/help/fr/index.ts from PartialLocaleContent to LocaleContent and
// the compiler goes back to proving parity forever. The parity test in
// registry.test.ts is the interim guard and will start failing the moment a
// French article is dropped after that.
//
// Phases 2 and 3 ship on ONE branch for this reason — /help is already public,
// and prod must never serve a French help center with six articles in it.
// Both levels are optional: a whole category may not be translated yet, and a
// translated category may be missing some of its articles.
export type PartialLocaleContent = Partial<{
  [C in CategorySlug]: {
    meta: HelpCategoryMeta;
    articles: Partial<{ [A in ArticleSlugOf<C>]: HelpArticle }>;
  };
}>;

const CONTENT: Record<AppLocale, LocaleContent | PartialLocaleContent> = {
  en: EN,
  fr: FR,
};

type CategoryEntry = {
  meta: HelpCategoryMeta;
  articles: Record<string, HelpArticle | undefined>;
};

// The category as this locale has it, or null if it isn't translated yet.
function entryOf(
  locale: AppLocale,
  category: CategorySlug,
): CategoryEntry | null {
  return (CONTENT[locale][category] as CategoryEntry | undefined) ?? null;
}

// The slugs actually available in a locale, in manifest order. English is
// always complete; French is whatever has been translated so far.
function availableSlugs(locale: AppLocale, category: CategorySlug): string[] {
  const entry = entryOf(locale, category);
  if (!entry) return [];
  return (HELP_STRUCTURE[category] as readonly string[]).filter(
    (slug) => entry.articles[slug],
  );
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export type ResolvedArticle = {
  categorySlug: CategorySlug;
  categoryTitle: string;
  slug: string;
  article: HelpArticle;
  headings: string[];
};

export type ResolvedCategory = {
  slug: CategorySlug;
  meta: HelpCategoryMeta;
  articles: { slug: string; article: HelpArticle }[];
};

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as string[]).includes(value);
}

// Categories in manifest order, which is display order. A category with
// nothing translated yet is dropped rather than shown as an empty card that
// leads to an empty page.
export function getCategories(locale: AppLocale): ResolvedCategory[] {
  return CATEGORY_SLUGS.map((slug) => getCategory(locale, slug)).filter(
    (c) => c.articles.length > 0,
  );
}

export function getCategory(
  locale: AppLocale,
  slug: CategorySlug,
): ResolvedCategory {
  const entry = entryOf(locale, slug);
  // Untranslated: fall back to the English meta so a caller always has a title
  // to render. It never reaches a reader — getCategories drops empty
  // categories and the category page 404s on them.
  const meta = entry?.meta ?? (EN[slug].meta as HelpCategoryMeta);
  const articles = availableSlugs(locale, slug).map((articleSlug) => ({
    slug: articleSlug,
    article: entry!.articles[articleSlug]!,
  }));
  return { slug, meta, articles };
}

export function getArticle(
  locale: AppLocale,
  categorySlug: string,
  articleSlug: string,
): ResolvedArticle | null {
  if (!isCategorySlug(categorySlug)) return null;
  const entry = entryOf(locale, categorySlug);
  if (!entry) return null;
  const article = entry.articles[articleSlug];
  if (!article) return null;
  return {
    categorySlug,
    categoryTitle: entry.meta.title,
    slug: articleSlug,
    article,
    headings: articleHeadings(article),
  };
}

// The category titles a locale can actually show. Used by the search index.
function categoryTitleOf(locale: AppLocale, category: CategorySlug): string {
  return entryOf(locale, category)?.meta.title ?? EN[category].meta.title;
}

// Every (category, article) pair in the manifest. Drives the sitemap, which
// is English-first and lists what the help center is meant to contain.
export function allArticlePaths(): { category: CategorySlug; article: string }[] {
  return CATEGORY_SLUGS.flatMap((category) =>
    (HELP_STRUCTURE[category] as readonly string[]).map((article) => ({
      category,
      article,
    })),
  );
}

// The paths that actually render in a given locale. generateStaticParams uses
// this so French doesn't prerender pages for articles it can't show yet.
export function articlePathsFor(
  locale: AppLocale,
): { category: CategorySlug; article: string }[] {
  return CATEGORY_SLUGS.flatMap((category) =>
    availableSlugs(locale, category).map((article) => ({ category, article })),
  );
}

// Which English articles have no French twin yet. Phase 3's job is to empty
// this; the parity test reports it.
export function untranslated(): { category: CategorySlug; article: string }[] {
  return allArticlePaths().filter(
    ({ category, article }) => !getArticle("fr", category, article),
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// One searchable record per article. `haystack` is pre-folded at build time so
// the browser never re-normalizes the corpus on every keystroke — only the
// query gets folded, which is one short string.
export type SearchRecord = {
  category: string;
  categoryTitle: string;
  slug: string;
  title: string;
  summary: string;
  haystack: string;
};

export function buildSearchIndex(locale: AppLocale): SearchRecord[] {
  return CATEGORY_SLUGS.flatMap((categorySlug) => {
    const entry = entryOf(locale, categorySlug);
    if (!entry) return [];
    const categoryTitle = categoryTitleOf(locale, categorySlug);
    // Only what this locale can actually open. Finding a result that leads
    // nowhere is worse than not finding it.
    return availableSlugs(locale, categorySlug).map((slug) => {
      const article = entry.articles[slug]!;
      return {
        category: categorySlug,
        categoryTitle,
        slug,
        title: article.title,
        summary: article.summary,
        haystack: normalizeText(`${categoryTitle} ${articleText(article)}`),
      };
    });
  });
}

// Every term must appear somewhere in the record (AND). With a corpus this
// small, OR-matching "invoice lock" would return anything mentioning either
// word, which is noise dressed up as results.
//
// Ranking: a title hit beats a summary hit beats a body hit. Within a tier,
// manifest order wins, so results stay stable and predictable rather than
// reshuffling as you type.
export function searchArticles(
  index: SearchRecord[],
  query: string,
): SearchRecord[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const scored: { record: SearchRecord; score: number }[] = [];
  for (const record of index) {
    if (!terms.every((t) => record.haystack.includes(t))) continue;
    const title = normalizeText(record.title);
    const summary = normalizeText(record.summary);
    const score = terms.every((t) => title.includes(t))
      ? 0
      : terms.every((t) => summary.includes(t))
        ? 1
        : 2;
    scored.push({ record, score });
  }

  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((s) => s.record);
}
