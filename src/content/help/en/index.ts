import type { LocaleContent } from "../registry";
import * as gettingStarted from "./getting-started";
import * as clients from "./clients";
import * as engagements from "./engagements";
import * as clientPortal from "./client-portal";
import * as documentsAndAi from "./documents-and-ai";
import * as eSignatures from "./e-signatures";
import * as paymentsAndInvoices from "./payments-and-invoices";
import * as messaging from "./messaging";
import * as reminders from "./reminders";
import * as quickbooks from "./quickbooks";
import * as team from "./team";
import * as account from "./account";
import * as aiHelpers from "./ai-helpers";
import * as security from "./security";
import * as about from "./about";

// The English help center. Typed against LocaleContent, which is derived from
// the manifest — so adding a slug to HELP_STRUCTURE without writing the article
// fails the build here, and vice versa. English is always complete; French is
// what's allowed to lag (see ../fr/index.ts).
export const EN: LocaleContent = {
  "getting-started": {
    meta: gettingStarted.meta,
    articles: gettingStarted.articles,
  },
  clients: { meta: clients.meta, articles: clients.articles },
  engagements: { meta: engagements.meta, articles: engagements.articles },
  "client-portal": { meta: clientPortal.meta, articles: clientPortal.articles },
  "documents-and-ai": {
    meta: documentsAndAi.meta,
    articles: documentsAndAi.articles,
  },
  "e-signatures": { meta: eSignatures.meta, articles: eSignatures.articles },
  "payments-and-invoices": {
    meta: paymentsAndInvoices.meta,
    articles: paymentsAndInvoices.articles,
  },
  messaging: { meta: messaging.meta, articles: messaging.articles },
  reminders: { meta: reminders.meta, articles: reminders.articles },
  quickbooks: { meta: quickbooks.meta, articles: quickbooks.articles },
  team: { meta: team.meta, articles: team.articles },
  account: { meta: account.meta, articles: account.articles },
  "ai-helpers": { meta: aiHelpers.meta, articles: aiHelpers.articles },
  security: { meta: security.meta, articles: security.articles },
  about: { meta: about.meta, articles: about.articles },
};
