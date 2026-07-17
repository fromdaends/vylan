// The help center's structure, declared once.
//
// This is the single source of truth for what exists and what order it shows
// in. English must cover every slug below or the build fails. French is
// allowed to lag during Phase 2 drafting and is held to the same bar in
// Phase 3 — see PartialLocaleContent in ./registry.
//
// Key order IS display order, on the index grid and in the sidebar. Slugs are
// English in both locales: a language toggle is then a pure /fr prefix swap
// with no slug translation table to keep in sync, and no risk of a French URL
// pointing at an article that moved.
//
// ORDER IS THE READING ORDER OF A REAL FIRM'S FIRST WEEK: what is this, then
// the people you serve, the work itself, the page your client sees, what
// happens to their files, getting signed and paid, talking to them, the
// chasing, the software you already run, your colleagues, your account, the
// questions your clients will ask you about security, and finally who we are.
//
// Every article listed here is written from the codebase and is real. Nothing
// below is a placeholder EXCEPT the About pages, which are deliberately and
// visibly unfinished pending the founders' own copy (see ./en/about.ts).

export const HELP_STRUCTURE = {
  "getting-started": [
    "what-is-vylan",
    "demo-mode-and-going-live",
    "your-first-engagement",
  ],
  clients: ["adding-clients", "importing-clients", "the-client-archive"],
  engagements: [
    "templates",
    "the-document-checklist",
    "workflow-stages",
    "statuses-and-stages",
    "completing-and-archiving",
    "deleting-and-restoring",
  ],
  "client-portal": ["how-your-client-gets-their-link", "how-clients-upload"],
  "documents-and-ai": ["how-vylan-checks-documents", "approving-and-rejecting"],
  "e-signatures": ["requesting-a-signature", "how-your-client-signs"],
  "payments-and-invoices": [
    "connecting-stripe",
    "creating-an-invoice",
    "how-your-client-pays",
    "invoice-automation",
    "the-invoice-lock",
    "sending-final-documents",
  ],
  messaging: ["messaging-your-client"],
  reminders: ["how-reminders-work", "changing-reminders"],
  quickbooks: [
    "connecting-quickbooks",
    "how-suggestions-work",
    "reviewing-drafts",
    "posting-to-quickbooks",
  ],
  team: [
    "turning-on-team-mode",
    "inviting-teammates",
    "owners-and-members",
    "assigning-work",
  ],
  account: [
    "your-profile",
    "every-setting",
    "two-factor-login",
    "firm-branding",
    "language-and-theme",
    "downloading-your-data",
    "the-audit-log",
  ],
  "ai-helpers": ["ask-vylan", "the-engagement-assistant"],
  security: [
    "where-your-data-lives",
    "how-client-access-works",
    "privacy-and-law-25",
  ],
  about: ["our-story", "the-founders"],
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
