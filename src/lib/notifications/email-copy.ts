// Email copy for every notification event, EN + FR.
//
// Why this is not next-intl: every other email in this repo builds its copy from
// locale-keyed literals in TS (see src/lib/email.ts), because emails are
// rendered from cron workers and job handlers that have no request context, and
// because email copy is full sentences while the settings UI needs short labels.
// The catalog remains the single source of truth for WHICH events exist; this
// file only says how each one reads in an inbox.
//
// House style: no em-dashes, "courriel" not "e-mail", Quebec professional
// French (vouvoiement throughout, no France-isms).
//
// Every headline is written to work at BOTH detail levels. `full` may name the
// client, document or amount; `minimal` must never leak one, because a firm
// choosing minimal is usually doing so for a shared inbox or Law 25 comfort.

export type EmailLocale = "en" | "fr";

export type NotificationCopy = {
  // Subject line and the bold first line of the body.
  headline: (v: CopyVars) => string;
  // The call-to-action button.
  cta: string;
};

export type CopyVars = {
  clientName: string | null;
  engagementTitle: string | null;
  documentName: string | null;
  amount: string | null;
  actorName: string | null;
  count: number;
  // When false, every name/amount above is already blanked by the caller.
  detailed: boolean;
};

// Small helper: use the detail when we have it and are allowed to show it,
// otherwise fall back to a neutral noun.
function some(value: string | null, vars: CopyVars, fallback: string): string {
  return vars.detailed && value ? value : fallback;
}

const EN: Record<string, NotificationCopy> = {
  "document.uploaded": {
    headline: (v) =>
      v.count > 1
        ? `${v.count} new documents from ${some(v.clientName, v, "a client")}`
        : `New document from ${some(v.clientName, v, "a client")}`,
    cta: "Open engagement",
  },
  "document.request_complete": {
    headline: (v) =>
      `${some(v.clientName, v, "A client")} has sent everything you asked for`,
    cta: "Review documents",
  },
  "document.ai_flagged": {
    headline: (v) =>
      `A document needs your eyes: ${some(v.documentName, v, "one file was flagged")}`,
    cta: "Review document",
  },
  "document.ai_rejected": {
    headline: (v) =>
      `${some(v.clientName, v, "A client")} was asked to re-send a document`,
    cta: "See what happened",
  },
  "document.ai_escalated": {
    headline: (v) =>
      `${some(v.clientName, v, "A client")} has tried several times and still needs help`,
    cta: "Step in",
  },
  "engagement.assigned_to_you": {
    headline: (v) =>
      `${some(v.actorName, v, "A teammate")} assigned you ${some(v.engagementTitle, v, "an engagement")}`,
    cta: "Open engagement",
  },
  "engagement.due_soon": {
    headline: (v) => `${some(v.engagementTitle, v, "An engagement")} is due soon`,
    cta: "Open engagement",
  },
  "engagement.overdue": {
    headline: (v) =>
      `${some(v.engagementTitle, v, "An engagement")} has passed its due date`,
    cta: "Open engagement",
  },
  "engagement.stalled": {
    headline: (v) =>
      `No movement on ${some(v.engagementTitle, v, "an engagement")} for a while`,
    cta: "Open engagement",
  },
  "engagement.completed": {
    headline: (v) =>
      `${some(v.engagementTitle, v, "An engagement")} was marked complete`,
    cta: "Open engagement",
  },
  "signature.completed": {
    headline: (v) => `${some(v.clientName, v, "A client")} signed`,
    cta: "View signature",
  },
  "signature.signed_copy_returned": {
    headline: (v) =>
      `${some(v.clientName, v, "A client")} sent back a signed document`,
    cta: "Review it",
  },
  "signature.declined": {
    headline: (v) => `${some(v.clientName, v, "A client")} declined to sign`,
    cta: "See details",
  },
  "payment.received": {
    headline: (v) =>
      v.detailed && v.amount
        ? `Payment received: ${v.amount}`
        : "A payment came in",
    cta: "View payment",
  },
  "payment.failed": {
    headline: (v) =>
      `A payment from ${some(v.clientName, v, "a client")} did not go through`,
    cta: "View details",
  },
  "message.client_replied": {
    headline: (v) =>
      v.count > 1
        ? `${v.count} new messages from ${some(v.clientName, v, "a client")}`
        : `${some(v.clientName, v, "A client")} replied`,
    cta: "Read and reply",
  },
  "message.internal_mention": {
    headline: (v) =>
      `${some(v.actorName, v, "A teammate")} mentioned you in a comment`,
    cta: "Open comment",
  },
  "client.portal_first_opened": {
    headline: (v) =>
      `${some(v.clientName, v, "A client")} opened their portal for the first time`,
    cta: "Open client",
  },
  "team.member_joined": {
    headline: (v) => `${some(v.actorName, v, "Someone new")} joined your firm`,
    cta: "Open team",
  },
  "integration.sync_failed": {
    headline: () => "An integration stopped syncing",
    cta: "Fix the connection",
  },
  "integration.disconnected": {
    headline: () => "An integration was disconnected",
    cta: "Reconnect",
  },
  "billing.payment_failed": {
    headline: () => "Your Vylan subscription payment did not go through",
    cta: "Update payment method",
  },
};

const FR: Record<string, NotificationCopy> = {
  "document.uploaded": {
    headline: (v) =>
      v.count > 1
        ? `${v.count} nouveaux documents de ${some(v.clientName, v, "un client")}`
        : `Nouveau document de ${some(v.clientName, v, "un client")}`,
    cta: "Ouvrir l'engagement",
  },
  "document.request_complete": {
    headline: (v) =>
      `${some(v.clientName, v, "Un client")} a envoyé tout ce que vous aviez demandé`,
    cta: "Réviser les documents",
  },
  "document.ai_flagged": {
    headline: (v) =>
      `Un document demande votre attention : ${some(v.documentName, v, "un fichier a été signalé")}`,
    cta: "Réviser le document",
  },
  "document.ai_rejected": {
    headline: (v) =>
      `${some(v.clientName, v, "Un client")} a été invité à renvoyer un document`,
    cta: "Voir ce qui s'est passé",
  },
  "document.ai_escalated": {
    headline: (v) =>
      `${some(v.clientName, v, "Un client")} a essayé plusieurs fois et a besoin d'aide`,
    cta: "Intervenir",
  },
  "engagement.assigned_to_you": {
    headline: (v) =>
      `${some(v.actorName, v, "Un collègue")} vous a assigné ${some(v.engagementTitle, v, "un engagement")}`,
    cta: "Ouvrir l'engagement",
  },
  "engagement.due_soon": {
    headline: (v) =>
      `L'échéance approche pour ${some(v.engagementTitle, v, "un engagement")}`,
    cta: "Ouvrir l'engagement",
  },
  "engagement.overdue": {
    headline: (v) =>
      `L'échéance est dépassée pour ${some(v.engagementTitle, v, "un engagement")}`,
    cta: "Ouvrir l'engagement",
  },
  "engagement.stalled": {
    headline: (v) =>
      `Aucun mouvement depuis un moment sur ${some(v.engagementTitle, v, "un engagement")}`,
    cta: "Ouvrir l'engagement",
  },
  "engagement.completed": {
    headline: (v) =>
      `${some(v.engagementTitle, v, "Un engagement")} a été marqué comme terminé`,
    cta: "Ouvrir l'engagement",
  },
  "signature.completed": {
    headline: (v) => `${some(v.clientName, v, "Un client")} a signé`,
    cta: "Voir la signature",
  },
  "signature.signed_copy_returned": {
    headline: (v) =>
      `${some(v.clientName, v, "Un client")} a retourné un document signé`,
    cta: "Le réviser",
  },
  "signature.declined": {
    headline: (v) => `${some(v.clientName, v, "Un client")} a refusé de signer`,
    cta: "Voir les détails",
  },
  "payment.received": {
    headline: (v) =>
      v.detailed && v.amount
        ? `Paiement reçu : ${v.amount}`
        : "Un paiement est entré",
    cta: "Voir le paiement",
  },
  "payment.failed": {
    headline: (v) =>
      `Un paiement de ${some(v.clientName, v, "un client")} n'a pas fonctionné`,
    cta: "Voir les détails",
  },
  "message.client_replied": {
    headline: (v) =>
      v.count > 1
        ? `${v.count} nouveaux messages de ${some(v.clientName, v, "un client")}`
        : `${some(v.clientName, v, "Un client")} a répondu`,
    cta: "Lire et répondre",
  },
  "message.internal_mention": {
    headline: (v) =>
      `${some(v.actorName, v, "Un collègue")} vous a mentionné dans un commentaire`,
    cta: "Ouvrir le commentaire",
  },
  "client.portal_first_opened": {
    headline: (v) =>
      `${some(v.clientName, v, "Un client")} a ouvert son portail pour la première fois`,
    cta: "Ouvrir le client",
  },
  "team.member_joined": {
    headline: (v) =>
      `${some(v.actorName, v, "Une nouvelle personne")} s'est jointe à votre cabinet`,
    cta: "Ouvrir l'équipe",
  },
  "integration.sync_failed": {
    headline: () => "Une intégration ne se synchronise plus",
    cta: "Corriger la connexion",
  },
  "integration.disconnected": {
    headline: () => "Une intégration a été déconnectée",
    cta: "Reconnecter",
  },
  "billing.payment_failed": {
    headline: () => "Le paiement de votre abonnement Vylan n'a pas fonctionné",
    cta: "Mettre à jour le mode de paiement",
  },
};

const BY_LOCALE: Record<EmailLocale, Record<string, NotificationCopy>> = {
  en: EN,
  fr: FR,
};

// Category headings used by digest emails.
export const CATEGORY_LABELS: Record<EmailLocale, Record<string, string>> = {
  en: {
    documents: "Documents",
    engagements: "Engagements",
    signatures: "Signatures",
    payments: "Payments",
    messages: "Messages",
    clients: "Clients",
    firm: "Your firm",
  },
  fr: {
    documents: "Documents",
    engagements: "Engagements",
    signatures: "Signatures",
    payments: "Paiements",
    messages: "Messages",
    clients: "Clients",
    firm: "Votre cabinet",
  },
};

export const CHROME: Record<
  EmailLocale,
  {
    greeting: (name: string | null) => string;
    digestSubject: (count: number) => string;
    digestIntro: (count: number) => string;
    minimalBody: string;
    settingsLink: string;
    turnOffLink: string;
    signoff: string;
  }
> = {
  en: {
    greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
    digestSubject: (count) =>
      count === 1 ? "1 update in Vylan" : `${count} updates in Vylan`,
    digestIntro: (count) =>
      count === 1
        ? "Here is what happened since your last summary."
        : `Here are the ${count} things that happened since your last summary.`,
    minimalBody: "You have new activity in Vylan.",
    settingsLink: "Notification settings",
    turnOffLink: "Turn off this type of email",
    signoff: "The Vylan team",
  },
  fr: {
    greeting: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    digestSubject: (count) =>
      count === 1 ? "1 nouveauté dans Vylan" : `${count} nouveautés dans Vylan`,
    digestIntro: (count) =>
      count === 1
        ? "Voici ce qui s'est passé depuis votre dernier résumé."
        : `Voici les ${count} choses qui se sont passées depuis votre dernier résumé.`,
    minimalBody: "Vous avez de nouvelles activités dans Vylan.",
    settingsLink: "Préférences de notification",
    turnOffLink: "Désactiver ce type de courriel",
    signoff: "L'équipe Vylan",
  },
};

export function copyFor(
  eventKey: string,
  locale: EmailLocale,
): NotificationCopy | null {
  return BY_LOCALE[locale][eventKey] ?? null;
}

// Every catalog key must have copy in BOTH locales. Exported so a test can
// assert parity rather than discovering a missing string in production.
export function copyKeys(locale: EmailLocale): string[] {
  return Object.keys(BY_LOCALE[locale]).sort();
}
