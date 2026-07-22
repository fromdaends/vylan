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
      days: (n) => `${n} days`,
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
      days: (n) => `${n} jours`,
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
  },
};

export function perfCopy(locale: AppLocale): PerfCopy {
  return PERF_COPY[locale] ?? PERF_COPY.en;
}
