// The help center's structure, declared once.
//
// This is the single source of truth for what exists and what order it shows
// in. Both locales are type-checked against it, so a category or article can
// never exist in English but silently 404 in French — that's a build error,
// not something a visitor discovers.
//
// Key order IS display order, on the index grid and in the sidebar. Slugs are
// English in both locales: a language toggle is then a pure /fr prefix swap
// with no slug translation table to keep in sync, and no risk of a French URL
// pointing at an article that moved.
//
// PHASE 1 ships the shell plus these three categories. The remaining eleven
// (engagements, e-signatures, payments and invoices, messaging, reminders,
// team and roles, QuickBooks, account and settings, clients, security and
// data, about) land in Phase 2 with the rest of the English content. Nothing
// here is a placeholder: every article listed below is written and real.

export const HELP_STRUCTURE = {
  "getting-started": ["what-is-vylan", "your-first-engagement"],
  "client-portal": ["how-your-client-gets-their-link", "how-clients-upload"],
  "documents-and-ai": ["how-vylan-checks-documents", "approving-and-rejecting"],
} as const;

export type CategorySlug = keyof typeof HELP_STRUCTURE;

export type ArticleSlugOf<C extends CategorySlug> =
  (typeof HELP_STRUCTURE)[C][number];

// Any article slug, in any category. Useful for links and lookups that don't
// know their category up front.
export type AnyArticleSlug = {
  [C in CategorySlug]: ArticleSlugOf<C>;
}[CategorySlug];

export const CATEGORY_SLUGS = Object.keys(HELP_STRUCTURE) as CategorySlug[];

export function articleSlugsOf<C extends CategorySlug>(
  category: C,
): readonly ArticleSlugOf<C>[] {
  return HELP_STRUCTURE[category];
}
