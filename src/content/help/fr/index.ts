import type { PartialLocaleContent } from "../registry";
import * as gettingStarted from "./getting-started";
import * as clientPortal from "./client-portal";
import * as documentsAndAi from "./documents-and-ai";

// The French help center.
//
// The prose is written in French rather than translated from the English, and
// it quotes the product's OWN French labels ("Téléverser", "Non applicable",
// "L'IA s'est trompée : approuver") straight from messages/fr.json. An article
// that translates a button name the app doesn't use is worse than no article:
// the reader goes looking for a button that isn't there.
//
// PHASE 2: typed PartialLocaleContent, NOT LocaleContent. English is being
// drafted for founder review and French follows in Phase 3, so slugs may exist
// in EN and not here yet. Untranslated articles are skipped everywhere (nav,
// search, sitemap, prerender) rather than shown broken — see the note on
// PartialLocaleContent in ../registry.
//
// PHASE 3: change this back to LocaleContent. That one word restores the
// compile-time guarantee that every English article has a French twin, which
// is the whole reason the content is typed. Do not skip it.
export const FR: PartialLocaleContent = {
  "getting-started": {
    meta: gettingStarted.meta,
    articles: gettingStarted.articles,
  },
  "client-portal": {
    meta: clientPortal.meta,
    articles: clientPortal.articles,
  },
  "documents-and-ai": {
    meta: documentsAndAi.meta,
    articles: documentsAndAi.articles,
  },
};
