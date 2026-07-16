import type { LocaleContent } from "../registry";
import * as gettingStarted from "./getting-started";
import * as clientPortal from "./client-portal";
import * as documentsAndAi from "./documents-and-ai";

// The French help center. Same LocaleContent type as EN, so the compiler holds
// the two in lockstep: a category or article that exists in English and not
// here is a build failure, not a 404 in production.
//
// The prose is written in French rather than translated from the English, and
// it quotes the product's OWN French labels ("Téléverser", "Non applicable",
// "L'IA s'est trompée : approuver") straight from messages/fr.json. An article
// that translates a button name the app doesn't use is worse than no article:
// the reader goes looking for a button that isn't there.
export const FR: LocaleContent = {
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
