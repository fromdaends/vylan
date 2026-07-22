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
