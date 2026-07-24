// Local bilingual copy for the Performance page.
//
// Phase 2 keeps these strings HERE rather than in messages/{en,fr}.json to stay
// out of that shared file while another session is actively editing it. Phase 4
// migrates this into next-intl as the dedicated "FR copy" pass. English is the
// default; French is the Quebec-market translation.

import type { AppLocale } from "@/lib/format";
import type { PerformanceRange } from "@/lib/performance/types";

export type PerfCopy = {
  title: string;
  subtitle: string;
  rangeLabel: string;
  ranges: Record<PerformanceRange, string>;
  loading: string;
  money: {
    heading: string;
    caption: string;
    collected: string;
    collectedCaption: string;
    payments: (n: number) => string;
    outstanding: string;
    outstandingCaption: string;
    timeToPaid: string;
    timeToPaidCaption: string;
    days: (n: string) => string;
    noneCollected: string;
    noneOutstanding: string;
    noTimeToPaid: string;
    lockOn: string;
    lockOff: string;
    lockHint: string;
    viewBars: string;
    viewLine: string;
    viewLabel: string;
    chartAria: string;
    topClients: string;
    // Money ↔ Documents full-section toggle (heading, tiles, chart, top-clients
    // all switch together).
    chartToggleAria: string;
    chartMoneyLabel: string;
    chartDocsLabel: string;
    chartDocsTitle: string;
    docsReceived: (n: number) => string;
    docsCount: (n: string, raw: number) => string;
    docsPerMonth: (n: string) => string;
    docsThisMonth: (n: number) => string;
    docsNone: string;
    // Documents-view section header + stat tiles + ranking.
    docsHeading: string;
    docsCaption: string;
    docsReceivedLabel: string;
    docsPendingLabel: string;
    docsPendingCaption: string;
    docsNonePending: string;
    docsTimeToReviewLabel: string;
    docsTimeToReviewCaption: string;
    docsNoTimeToReview: string;
    docsTopClients: string;
    // Received tile now leads with the per-month average (not a period total).
    docsPerMonthCaption: string;
    docsThisMonthCaption: string;
    docsReceivedTotal: (n: string) => string;
    // Top-clients ranking: show 3, reveal the rest behind a toggle.
    topClientsMore: (n: number) => string;
    topClientsLess: string;
  };
  ai: {
    heading: string;
    caption: string;
    agreement: (percent: string, count: number) => string;
    agreementWord: string;
    cases: {
      true_pass: string;
      true_catch: string;
      false_pass: string;
      false_alarm: string;
    };
    tagAgreement: string;
    tagMissed: string;
    tagFalseAlarm: string;
    assessed: (n: number) => string;
    skipped: (n: number) => string;
    methodology: string;
    earlyData: (n: number) => string;
    empty: string;
    // "AI usage this month" meter — mirrors Settings > Documents (getFirmAiUsage).
    usageHeading: string;
    usageLabel: string;
    usageCount: (used: string, cap: string) => string;
    usageCountTrial: (used: string, cap: string) => string;
    usageRemaining: (n: string) => string;
    usageResets: (date: string) => string;
    usagePaused: string;
  };
  automation: {
    heading: string;
    remindersLabel: string;
    remindersHint: string;
    reRequestsLabel: string;
    reRequestsHint: string;
  };
};

export const PERF_COPY: Record<AppLocale, PerfCopy> = {
  en: {
    title: "Performance",
    subtitle: "How Vylan is doing for your firm.",
    rangeLabel: "Time range",
    ranges: {
      this_month: "This month",
      last_3_months: "Last 3 months",
      all_time: "All time",
    },
    loading: "Updating…",
    money: {
      heading: "Money",
      caption: "Payments collected through Vylan.",
      collected: "Collected",
      collectedCaption: "in this period",
      payments: (n) => `${n} ${n === 1 ? "payment" : "payments"}`,
      outstanding: "Outstanding",
      outstandingCaption: "unpaid right now",
      timeToPaid: "Time to paid",
      timeToPaidCaption: "average, invoices paid in this period",
      days: (n) => `${n} ${n === "1" ? "day" : "days"}`,
      noneCollected: "No payments collected in this period yet.",
      noneOutstanding: "Nothing outstanding.",
      noTimeToPaid: "No invoices paid in this period yet.",
      lockOn: "Documents locked until paid",
      lockOff: "No document lock",
      lockHint: "Average days to get paid, split by whether the invoice held documents until payment.",
      viewBars: "Bars",
      viewLine: "Trend",
      viewLabel: "Chart view",
      chartAria: "Money collected over time",
      topClients: "Top clients",
      chartToggleAria: "Chart data",
      chartMoneyLabel: "Money",
      chartDocsLabel: "Documents",
      chartDocsTitle: "Documents received over time",
      docsReceived: (n) => `${n} ${n === 1 ? "document" : "documents"} received`,
      docsCount: (n, raw) => `${n} ${raw === 1 ? "document" : "documents"}`,
      docsPerMonth: (n) => `avg. ${n}/month`,
      docsThisMonth: (n) =>
        `${n} ${n === 1 ? "document" : "documents"} received this month`,
      docsNone: "No documents received in this period yet.",
      docsHeading: "Documents",
      docsCaption: "Documents received from your clients.",
      docsReceivedLabel: "Received",
      docsPendingLabel: "Pending review",
      docsPendingCaption: "awaiting your review right now",
      docsNonePending: "Nothing awaiting review.",
      docsTimeToReviewLabel: "Time to review",
      docsTimeToReviewCaption: "average, from upload to your review",
      docsNoTimeToReview: "No documents reviewed in this period yet.",
      docsTopClients: "Top clients by documents",
      docsPerMonthCaption: "per month, on average",
      docsThisMonthCaption: "received this month",
      docsReceivedTotal: (n) => `${n} total`,
      topClientsMore: (n) => `View all ${n}`,
      topClientsLess: "Show less",
    },
    ai: {
      heading: "AI performance",
      caption: "How Vylan's document checks stack up against your final calls.",
      agreement: (percent, count) =>
        `You agreed with Vylan's assessment on ${percent}% of ${count} ${count === 1 ? "document" : "documents"}.`,
      agreementWord: "agreement",
      cases: {
        true_pass: "AI approved, you approved",
        true_catch: "AI flagged, you rejected",
        false_pass: "AI approved, you rejected",
        false_alarm: "AI flagged, you approved",
      },
      tagAgreement: "Agreement",
      tagMissed: "The miss that matters",
      tagFalseAlarm: "Safe but noisy",
      assessed: (n) => `${n} ${n === 1 ? "document" : "documents"} checked`,
      skipped: (n) => `${n} skipped (AI was off)`,
      methodology:
        "This compares Vylan's assessment of each document with your final decision on it. We count only documents where Vylan gave a verdict and you approved or rejected the document. A document that was re-uploaded or that you reopened is counted once, at your final decision.",
      earlyData: (n) =>
        `Early data. Based on only ${n} ${n === 1 ? "document" : "documents"} so far, so treat this as a first look rather than a firm track record.`,
      empty: "No documents assessed in this period yet.",
      usageHeading: "AI usage this month",
      usageLabel: "AI document checks",
      usageCount: (used, cap) => `${used} of ${cap} used this month`,
      usageCountTrial: (used, cap) => `${used} of ${cap} free-trial checks used`,
      usageRemaining: (n) => `${n} left`,
      usageResets: (date) => `resets ${date}`,
      usagePaused: "Paused",
    },
    automation: {
      heading: "What Vylan did automatically",
      remindersLabel: "Reminders sent",
      remindersHint: "automatic follow-ups you didn't have to send",
      reRequestsLabel: "Documents re-requested",
      reRequestsHint: "chased automatically after an auto-rejection",
    },
  },
  fr: {
    title: "Performance",
    subtitle: "Comment Vylan performe pour votre cabinet.",
    rangeLabel: "Période",
    ranges: {
      this_month: "Ce mois-ci",
      last_3_months: "3 derniers mois",
      all_time: "Depuis le début",
    },
    loading: "Mise à jour…",
    money: {
      heading: "Argent",
      caption: "Paiements encaissés via Vylan.",
      collected: "Encaissé",
      collectedCaption: "sur la période",
      payments: (n) => `${n} ${n === 1 ? "paiement" : "paiements"}`,
      outstanding: "À recevoir",
      outstandingCaption: "impayé en ce moment",
      timeToPaid: "Délai de paiement",
      timeToPaidCaption: "moyenne, factures payées sur la période",
      days: (n) => `${n} ${n === "1" ? "jour" : "jours"}`,
      noneCollected: "Aucun paiement encaissé sur cette période pour l'instant.",
      noneOutstanding: "Rien à recevoir.",
      noTimeToPaid: "Aucune facture payée sur cette période pour l'instant.",
      lockOn: "Documents verrouillés jusqu'au paiement",
      lockOff: "Sans verrou des documents",
      lockHint: "Nombre moyen de jours pour être payé, selon que la facture retenait ou non les documents jusqu'au paiement.",
      viewBars: "Barres",
      viewLine: "Tendance",
      viewLabel: "Type de graphique",
      chartAria: "Sommes encaissées dans le temps",
      topClients: "Meilleurs clients",
      chartToggleAria: "Données du graphique",
      chartMoneyLabel: "Argent",
      chartDocsLabel: "Documents",
      chartDocsTitle: "Documents reçus dans le temps",
      docsReceived: (n) => `${n} document${n === 1 ? "" : "s"} reçu${n === 1 ? "" : "s"}`,
      docsCount: (n, raw) => `${n} document${raw === 1 ? "" : "s"}`,
      docsPerMonth: (n) => `moy. ${n}/mois`,
      docsThisMonth: (n) =>
        `${n} document${n === 1 ? "" : "s"} reçu${n === 1 ? "" : "s"} ce mois-ci`,
      docsNone: "Aucun document reçu sur cette période pour l'instant.",
      docsHeading: "Documents",
      docsCaption: "Documents reçus de vos clients.",
      docsReceivedLabel: "Reçus",
      docsPendingLabel: "En attente de révision",
      docsPendingCaption: "en attente de votre révision en ce moment",
      docsNonePending: "Rien en attente de révision.",
      docsTimeToReviewLabel: "Délai de révision",
      docsTimeToReviewCaption: "moyenne, du dépôt à votre révision",
      docsNoTimeToReview: "Aucun document révisé sur cette période pour l'instant.",
      docsTopClients: "Meilleurs clients par documents",
      docsPerMonthCaption: "par mois, en moyenne",
      docsThisMonthCaption: "reçus ce mois-ci",
      docsReceivedTotal: (n) => `${n} au total`,
      topClientsMore: (n) => `Voir les ${n}`,
      topClientsLess: "Réduire",
    },
    ai: {
      heading: "Performance de l'IA",
      caption:
        "Comment les vérifications de Vylan se comparent à vos décisions finales.",
      agreement: (percent, count) =>
        `Vous étiez d'accord avec l'évaluation de Vylan pour ${percent} % de ${count} document${count === 1 ? "" : "s"}.`,
      agreementWord: "d'accord",
      cases: {
        true_pass: "IA a approuvé, vous avez approuvé",
        true_catch: "IA a signalé, vous avez rejeté",
        false_pass: "IA a approuvé, vous avez rejeté",
        false_alarm: "IA a signalé, vous avez approuvé",
      },
      tagAgreement: "Accord",
      tagMissed: "L'erreur qui compte",
      tagFalseAlarm: "Sûr mais bruyant",
      assessed: (n) =>
        `${n} document${n === 1 ? "" : "s"} vérifié${n === 1 ? "" : "s"}`,
      skipped: (n) => `${n} ignoré${n === 1 ? "" : "s"} (IA désactivée)`,
      methodology:
        "Ceci compare l'évaluation de Vylan pour chaque document à votre décision finale. Nous comptons seulement les documents que Vylan a évalués et que vous avez approuvés ou rejetés. Un document re-téléversé ou rouvert est compté une seule fois, à votre décision finale.",
      earlyData: (n) =>
        `Données préliminaires. Basé sur seulement ${n} document${n === 1 ? "" : "s"} pour l'instant; voyez ceci comme un premier aperçu plutôt qu'un bilan établi.`,
      empty: "Aucun document évalué sur cette période pour l'instant.",
      usageHeading: "Utilisation de l'IA ce mois-ci",
      usageLabel: "Vérifications IA de documents",
      usageCount: (used, cap) => `${used} sur ${cap} utilisées ce mois-ci`,
      usageCountTrial: (used, cap) =>
        `${used} sur ${cap} vérifications d'essai utilisées`,
      usageRemaining: (n) => `${n} restantes`,
      usageResets: (date) => `réinitialise le ${date}`,
      usagePaused: "En pause",
    },
    automation: {
      heading: "Ce que Vylan a fait automatiquement",
      remindersLabel: "Rappels envoyés",
      remindersHint: "relances automatiques que vous n'avez pas eu à envoyer",
      reRequestsLabel: "Documents redemandés",
      reRequestsHint: "relancés automatiquement après un rejet automatique",
    },
  },
};

export function perfCopy(locale: AppLocale): PerfCopy {
  return PERF_COPY[locale] ?? PERF_COPY.en;
}
