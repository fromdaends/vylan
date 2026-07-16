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

const CONTENT: Record<AppLocale, LocaleContent> = { en: EN, fr: FR };

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

// Categories in manifest order, which is display order.
export function getCategories(locale: AppLocale): ResolvedCategory[] {
  return CATEGORY_SLUGS.map((slug) => getCategory(locale, slug));
}

export function getCategory(
  locale: AppLocale,
  slug: CategorySlug,
): ResolvedCategory {
  const entry = CONTENT[locale][slug];
  const articles = (HELP_STRUCTURE[slug] as readonly string[]).map(
    (articleSlug) => ({
      slug: articleSlug,
      article: (entry.articles as Record<string, HelpArticle>)[articleSlug]!,
    }),
  );
  return { slug, meta: entry.meta, articles };
}

export function getArticle(
  locale: AppLocale,
  categorySlug: string,
  articleSlug: string,
): ResolvedArticle | null {
  if (!isCategorySlug(categorySlug)) return null;
  const entry = CONTENT[locale][categorySlug];
  const article = (entry.articles as Record<string, HelpArticle>)[articleSlug];
  if (!article) return null;
  return {
    categorySlug,
    categoryTitle: entry.meta.title,
    slug: articleSlug,
    article,
    headings: articleHeadings(article),
  };
}

// Every (category, article) pair. Drives generateStaticParams and the sitemap.
export function allArticlePaths(): { category: CategorySlug; article: string }[] {
  return CATEGORY_SLUGS.flatMap((category) =>
    (HELP_STRUCTURE[category] as readonly string[]).map((article) => ({
      category,
      article,
    })),
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
    const entry = CONTENT[locale][categorySlug];
    return (HELP_STRUCTURE[categorySlug] as readonly string[]).map((slug) => {
      const article = (entry.articles as Record<string, HelpArticle>)[slug]!;
      return {
        category: categorySlug,
        categoryTitle: entry.meta.title,
        slug,
        title: article.title,
        summary: article.summary,
        haystack: normalizeText(
          `${entry.meta.title} ${articleText(article)}`,
        ),
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
