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

// The French help center.
//
// PHASE 3 IS DONE, so this is typed LocaleContent again, NOT
// PartialLocaleContent. That one word is the whole point of typed content: the
// compiler now proves every English article has a French twin, forever. Delete
// a French article and the build fails rather than a reader in Trois-Rivières
// finding the hole.
//
// The prose is written in French rather than translated from the English, and
// it quotes the product's OWN French labels straight from messages/fr.json:
// "Téléverser", "Non applicable", "L'IA s'est trompée : approuver",
// "Collecte de documents", "Verrouillés jusqu'au paiement". An article that
// translates a button name the app doesn't use is worse than no article — the
// reader goes looking for a button that isn't there.
//
// Two traps worth remembering if you add to this:
//   * The non-owner role is "Membre" and the owner is "Administrateur", NOT
//     "Propriétaire". Check Team.role_owner before you write it.
//   * The product says both "engagement" and "mandat" for the same thing.
//     These articles lead with "engagement" (the word on the button) and use
//     "mandat" naturally around it.
export const FR: LocaleContent = {
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
