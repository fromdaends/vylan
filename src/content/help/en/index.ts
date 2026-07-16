import type { LocaleContent } from "../registry";
import * as gettingStarted from "./getting-started";
import * as clientPortal from "./client-portal";
import * as documentsAndAi from "./documents-and-ai";

// The English help center. Typed against LocaleContent, which is derived from
// the manifest — so adding a slug to HELP_STRUCTURE without writing the article
// fails the build here, and vice versa.
export const EN: LocaleContent = {
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
