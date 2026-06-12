import type { DocType } from "@/lib/db/templates";

// Single source of truth for every document type Vylan understands: its
// bilingual display name, the group it belongs to (for grouped pickers), and
// the English description fed to the AI classifier. Both the doc-type dropdowns
// (client) and the AI classifier (server) derive from this map, so a code can
// never exist without a correct FR/EN name and an AI description.
//
// Names verified against CRA (canada.ca) and Revenu Québec (revenuquebec.ca)
// official form titles. French is the legal/primary name for the Quebec (RL)
// slips. This file imports ONLY the `DocType` type (erased at build) so it is
// safe to import from client components.

export type DocTypeGroup =
  | "federal"
  | "quebec"
  | "credits"
  | "forms"
  | "bookkeeping"
  | "other";

export type DocTypeMeta = {
  /** English display label. */
  en: string;
  /** French display label (legal name for RL slips). */
  fr: string;
  group: DocTypeGroup;
  /** English description handed to the AI classifier reference. */
  ai: string;
};

// The `Record<DocType, …>` makes TypeScript fail the build if any DocType is
// missing a label — adding a code to the union forces adding it here.
export const DOC_TYPE_LABELS: Record<DocType, DocTypeMeta> = {
  // ── Federal slips ───────────────────────────────────────────────────────
  t4: {
    en: "T4 — Statement of Remuneration Paid",
    fr: "T4 — État de la rémunération payée",
    group: "federal",
    ai: "T4 federal employment income slip (pairs with the Quebec RL-1).",
  },
  t4a: {
    en: "T4A — Pension, Retirement, Annuity & Other Income",
    fr: "T4A — Revenus de pension, de retraite, de rente ou autres",
    group: "federal",
    ai: "T4A federal slip — pensions, annuities, self-employed commissions, fees for services, scholarships (catch-all 'other income').",
  },
  t4a_oas: {
    en: "T4A(OAS) — Old Age Security",
    fr: "T4A(OAS) — Sécurité de la vieillesse",
    group: "federal",
    ai: "T4A(OAS) — Old Age Security pension / GIS (clients 65+).",
  },
  t4a_p: {
    en: "T4A(P) — CPP/QPP Benefits",
    fr: "T4A(P) — Prestations du RPC/RRQ",
    group: "federal",
    ai: "T4A(P) — Canada/Quebec Pension Plan benefits (retirement, disability, survivor).",
  },
  t4e: {
    en: "T4E — Employment Insurance Benefits",
    fr: "T4E — Prestations d'assurance-emploi",
    group: "federal",
    ai: "T4E — Employment Insurance (EI) benefits. Quebec residents get a T4E(Q).",
  },
  t4rsp: {
    en: "T4RSP — RRSP Income",
    fr: "T4RSP — Revenus de REER",
    group: "federal",
    ai: "T4RSP — RRSP withdrawals/income, incl. Home Buyers' Plan and Lifelong Learning Plan (pairs with RL-2).",
  },
  t4rif: {
    en: "T4RIF — RRIF Income",
    fr: "T4RIF — Revenus de FERR",
    group: "federal",
    ai: "T4RIF — payments from a Registered Retirement Income Fund (pairs with RL-2).",
  },
  t5: {
    en: "T5 — Statement of Investment Income",
    fr: "T5 — État des revenus de placements",
    group: "federal",
    ai: "T5 federal investment income slip — interest, dividends (pairs with RL-3).",
  },
  t5008: {
    en: "T5008 — Securities Transactions",
    fr: "T5008 — Opérations sur titres",
    group: "federal",
    ai: "T5008 — proceeds from selling/redeeming securities (needed for capital gains; pairs with the Quebec RL-18).",
  },
  t5013: {
    en: "T5013 — Partnership Income",
    fr: "T5013 — Revenus de société de personnes",
    group: "federal",
    ai: "T5013 — a partner's share of partnership income/loss (pairs with RL-15).",
  },
  t3: {
    en: "T3 — Statement of Trust Income",
    fr: "T3 — Revenus de fiducie",
    group: "federal",
    ai: "T3 federal trust income slip — mutual funds, trusts, ETFs (pairs with RL-16).",
  },
  nr4: {
    en: "NR4 — Amounts Paid to Non-Residents",
    fr: "NR4 — Sommes payées à des non-résidents",
    group: "federal",
    ai: "NR4 — Canadian-source income paid to a non-resident, with Part XIII tax withheld.",
  },

  // ── Quebec slips (Relevés) ──────────────────────────────────────────────
  rl1: {
    en: "RL-1 — Employment and Other Income",
    fr: "RL-1 — Revenus d'emploi et revenus divers",
    group: "quebec",
    ai: "Quebec RL-1 — employment and other income (provincial T4 equivalent).",
  },
  rl2: {
    en: "RL-2 — Retirement and Annuity Income",
    fr: "RL-2 — Revenus de retraite et rentes",
    group: "quebec",
    ai: "Quebec RL-2 — retirement and annuity income (pairs with T4A / T4RSP / T4RIF).",
  },
  rl3: {
    en: "RL-3 — Investment Income",
    fr: "RL-3 — Revenus de placement",
    group: "quebec",
    ai: "Quebec RL-3 — investment income (provincial T5 equivalent).",
  },
  rl5: {
    en: "RL-5 — Benefits and Indemnities",
    fr: "RL-5 — Prestations et indemnités",
    group: "quebec",
    ai: "Quebec RL-5 — social assistance plus CNESST / SAAQ indemnities.",
  },
  rl6: {
    en: "RL-6 — Québec Parental Insurance Plan",
    fr: "RL-6 — Régime québécois d'assurance parentale",
    group: "quebec",
    ai: "Quebec RL-6 — QPIP (parental insurance) benefits.",
  },
  rl7: {
    en: "RL-7 — Investments in an Investment Plan",
    fr: "RL-7 — Placements dans un régime d'investissement",
    group: "quebec",
    ai: "Quebec RL-7 — investments in a Cooperative Investment Plan (CIP).",
  },
  rl8: {
    en: "RL-8 — Amount for Post-Secondary Studies",
    fr: "RL-8 — Montant pour études postsecondaires",
    group: "quebec",
    ai: "Quebec RL-8 — post-secondary studies amount / tuition (pairs with T2202).",
  },
  rl10: {
    en: "RL-10 — Labour-Sponsored Fund Tax Credit",
    fr: "RL-10 — Crédit d'impôt relatif à un fonds de travailleurs",
    group: "quebec",
    ai: "Quebec RL-10 — labour-sponsored fund shares (FTQ / Fondaction) tax credit.",
  },
  rl15: {
    en: "RL-15 — Amounts Allocated to Partnership Members",
    fr: "RL-15 — Montants attribués aux membres d'une société de personnes",
    group: "quebec",
    ai: "Quebec RL-15 — amounts allocated to members of a partnership (pairs with T5013).",
  },
  rl16: {
    en: "RL-16 — Trust Income",
    fr: "RL-16 — Revenus de fiducie",
    group: "quebec",
    ai: "Quebec RL-16 — trust income allocated to beneficiaries (provincial T3 equivalent).",
  },
  rl18: {
    en: "RL-18 — Securities Transactions",
    fr: "RL-18 — Transactions de titres",
    group: "quebec",
    ai: "Quebec RL-18 — securities transactions (provincial T5008 equivalent).",
  },
  rl19: {
    en: "RL-19 — Advance Payments of Tax Credits",
    fr: "RL-19 — Versements anticipés de crédits d'impôt",
    group: "quebec",
    ai: "Quebec RL-19 — advance payments of tax credits (childcare, home support, work premium).",
  },
  rl24: {
    en: "RL-24 — Childcare Expenses",
    fr: "RL-24 — Frais de garde d'enfants",
    group: "quebec",
    ai: "Quebec RL-24 — childcare expenses eligible for the Quebec childcare tax credit.",
  },
  rl25: {
    en: "RL-25 — Income from a Profit-Sharing Plan",
    fr: "RL-25 — Revenus d'un régime d'intéressement",
    group: "quebec",
    ai: "Quebec RL-25 — income from an employee profit-sharing plan (pairs with T4PS).",
  },
  rl26: {
    en: "RL-26 — Capital régional et coopératif Desjardins",
    fr: "RL-26 — Capital régional et coopératif Desjardins",
    group: "quebec",
    ai: "Quebec RL-26 — Capital régional et coopératif Desjardins (CRCD) share purchases tax credit.",
  },
  rl27: {
    en: "RL-27 — Government Payments",
    fr: "RL-27 — Paiements du gouvernement",
    group: "quebec",
    ai: "Quebec RL-27 — government contract / subsidy / assistance payments.",
  },
  rl31: {
    en: "RL-31 — Information About a Leased Dwelling",
    fr: "RL-31 — Renseignements sur l'occupation d'un logement",
    group: "quebec",
    ai: "Quebec RL-31 — leased-dwelling slip a landlord issues to tenants; used to claim the solidarity tax credit (Schedule D). No federal equivalent.",
  },
  rl32: {
    en: "RL-32 — First Home Savings Account",
    fr: "RL-32 — Compte d'épargne libre d'impôt pour l'achat d'une première propriété",
    group: "quebec",
    ai: "Quebec RL-32 — First Home Savings Account amounts (provincial side of the T4FHSA).",
  },

  // ── Credits & receipts ──────────────────────────────────────────────────
  rrsp: {
    en: "RRSP contribution receipt",
    fr: "Reçu de cotisation REER",
    group: "credits",
    ai: "RRSP contribution receipt — proves RRSP contributions (first-60-days and rest-of-year).",
  },
  fhsa: {
    en: "FHSA — First Home Savings Account",
    fr: "CELIAPP — Compte d'épargne libre d'impôt pour l'achat d'une première propriété",
    group: "credits",
    ai: "FHSA / CELIAPP documents — the T4FHSA slip and/or FHSA contribution receipt (new since 2023).",
  },
  t2202: {
    en: "T2202 — Tuition and Enrolment Certificate",
    fr: "T2202 — Frais de scolarité et d'inscription",
    group: "credits",
    ai: "T2202 — tuition and months of enrolment from a post-secondary institution (pairs with RL-8).",
  },
  medical: {
    en: "Medical receipts",
    fr: "Reçus médicaux",
    group: "credits",
    ai: "Medical expense receipts (dentist, pharmacy, etc.).",
  },
  donation: {
    en: "Donation receipts",
    fr: "Reçus de dons",
    group: "credits",
    ai: "Official donation receipts from registered charities.",
  },

  // ── Forms, returns & assessments ────────────────────────────────────────
  t1135: {
    en: "T1135 — Foreign Income Verification Statement",
    fr: "T1135 — Vérification du revenu étranger",
    group: "forms",
    ai: "T1135 Foreign Income Verification Statement (required when the client held more than CAD $100,000 in foreign property at any point during the year — foreign stocks/ETFs in a non-registered account, foreign rental property, foreign bank accounts, etc.).",
  },
  t2125: {
    en: "T2125 — Statement of Business or Professional Activities",
    fr: "T2125 — Revenus d'entreprise ou de profession",
    group: "forms",
    ai: "T2125 Statement of Business or Professional Activities (self-employment / freelance / small-business income and expenses).",
  },
  t2200: {
    en: "T2200 — Declaration of Conditions of Employment",
    fr: "T2200 — Déclaration des conditions de travail",
    group: "forms",
    ai: "T2200 — employer-signed declaration letting an employee deduct employment expenses (Quebec equivalent: TP-64.3).",
  },
  t2091: {
    en: "T2091 — Principal Residence Designation",
    fr: "T2091 — Désignation de résidence principale",
    group: "forms",
    ai: "T2091(IND) — designation/reporting of the sale of a principal residence.",
  },
  t2201: {
    en: "T2201 — Disability Tax Credit Certificate",
    fr: "T2201 — Certificat pour le crédit d'impôt pour personnes handicapées",
    group: "forms",
    ai: "T2201 — Disability Tax Credit certificate (certifies a severe, prolonged impairment).",
  },
  noa: {
    en: "Notice of Assessment",
    fr: "Avis de cotisation",
    group: "forms",
    ai: "Notice of Assessment from CRA (and/or Revenu Québec) — shows balance, RRSP room, carryforwards.",
  },

  // ── Bookkeeping & business ──────────────────────────────────────────────
  bank_statement: {
    en: "Bank statements",
    fr: "Relevés bancaires",
    group: "bookkeeping",
    ai: "monthly bank statement.",
  },
  credit_card_statement: {
    en: "Credit card statements",
    fr: "Relevés de carte de crédit",
    group: "bookkeeping",
    ai: "monthly credit card statement.",
  },
  invoice: {
    en: "Sales invoices",
    fr: "Factures de vente",
    group: "bookkeeping",
    ai: "sales invoice issued by the business.",
  },
  receipt: {
    en: "Expense receipts",
    fr: "Reçus de dépenses",
    group: "bookkeeping",
    ai: "generic expense receipt (incl. childcare, moving, etc.).",
  },
  gst_hst_qst: {
    en: "GST/HST/QST filings",
    fr: "Déclarations TPS/TVH/TVQ",
    group: "bookkeeping",
    ai: "sales tax filing — in Quebec, GST/HST and QST are filed together (FPZ-500).",
  },
  rental: {
    en: "Rental income summary",
    fr: "Sommaire des revenus locatifs",
    group: "bookkeeping",
    ai: "rental property income/expense summary (feeds T776 / Quebec TP-128).",
  },
  trial_balance: {
    en: "Trial balance",
    fr: "Balance de vérification",
    group: "bookkeeping",
    ai: "corporate trial balance as of the fiscal year end.",
  },
  gl_export: {
    en: "General ledger (export)",
    fr: "Grand livre (export)",
    group: "bookkeeping",
    ai: "full general-ledger export for the fiscal year.",
  },
  financials: {
    en: "Financial statements",
    fr: "États financiers",
    group: "bookkeeping",
    ai: "financial statements (often prior-year, for the corporate file).",
  },
  shareholder_loan: {
    en: "Shareholder loan / advances",
    fr: "Prêts/avances aux actionnaires",
    group: "bookkeeping",
    ai: "shareholder loan / advances activity.",
  },
  payroll_summary: {
    en: "Payroll summary (T4 / RL-1)",
    fr: "Sommaire de paie (T4 / RL-1)",
    group: "bookkeeping",
    ai: "year-end payroll summary (T4 Summary and/or Quebec RL-1 Summary).",
  },
  capital_asset: {
    en: "Capital asset additions / disposals",
    fr: "Ajouts/dispositions d'immobilisations",
    group: "bookkeeping",
    ai: "capital asset additions or disposals (purchase invoices, sale agreements).",
  },
  inventory: {
    en: "Year-end inventory",
    fr: "Inventaire de fin d'exercice",
    group: "bookkeeping",
    ai: "fiscal year-end inventory count/valuation.",
  },

  // ── Other ───────────────────────────────────────────────────────────────
  other: {
    en: "Other",
    fr: "Autre",
    group: "other",
    ai: "anything else.",
  },
};

export const DOC_TYPE_GROUP_ORDER: DocTypeGroup[] = [
  "federal",
  "quebec",
  "credits",
  "forms",
  "bookkeeping",
  "other",
];

export const DOC_TYPE_GROUP_LABELS: Record<
  DocTypeGroup,
  { en: string; fr: string }
> = {
  federal: { en: "Federal slips", fr: "Feuillets fédéraux" },
  quebec: { en: "Quebec slips (Relevés)", fr: "Feuillets québécois (relevés)" },
  credits: { en: "Credits & receipts", fr: "Crédits et reçus" },
  forms: { en: "Forms & returns", fr: "Formulaires et déclarations" },
  bookkeeping: { en: "Bookkeeping & business", fr: "Tenue de livres et entreprise" },
  other: { en: "Other", fr: "Autre" },
};

type Lang = "en" | "fr";

/** Display label for a doc type in the given locale (falls back to the code). */
export function docTypeLabel(code: DocType, locale: string): string {
  const lang: Lang = locale === "fr" ? "fr" : "en";
  return DOC_TYPE_LABELS[code]?.[lang] ?? code;
}

/** Group heading in the given locale. */
export function docTypeGroupLabel(group: DocTypeGroup, locale: string): string {
  const lang: Lang = locale === "fr" ? "fr" : "en";
  return DOC_TYPE_GROUP_LABELS[group][lang];
}

// Every doc-type code, ordered by group then by declaration order within the
// group — the canonical order for the picker dropdowns.
export const DOC_TYPES: DocType[] = (
  Object.keys(DOC_TYPE_LABELS) as DocType[]
).sort(
  (a, b) =>
    DOC_TYPE_GROUP_ORDER.indexOf(DOC_TYPE_LABELS[a].group) -
    DOC_TYPE_GROUP_ORDER.indexOf(DOC_TYPE_LABELS[b].group),
);

// Quebec is the ONLY Canadian province with its own slip system (the RL /
// Relevé slips). Every other province uses the federal T-slips — the CRA
// administers provincial tax everywhere except Quebec — so the only
// province-restricted group is "quebec". An Ontario (or any non-QC) client
// should never be asked for an RL slip they can't obtain.
//
// A null/empty province means "not set" → applies (show everything), so
// existing clients/firms that never set a province see no change. An explicit
// non-QC province hides the Quebec-only slips.
export function appliesToProvince(
  code: DocType,
  province: string | null | undefined,
): boolean {
  if (!province) return true;
  return DOC_TYPE_LABELS[code]?.group === "quebec" ? province === "QC" : true;
}

/**
 * Codes bucketed by group, in display order — for grouped pickers. Pass a
 * `province` to show only the document types that apply there (drops the Quebec
 * RL slips for non-Quebec clients).
 */
export function docTypesByGroup(
  province?: string | null,
): { group: DocTypeGroup; codes: DocType[] }[] {
  return DOC_TYPE_GROUP_ORDER.map((group) => ({
    group,
    codes: (Object.keys(DOC_TYPE_LABELS) as DocType[]).filter(
      (code) =>
        DOC_TYPE_LABELS[code].group === group &&
        appliesToProvince(code, province),
    ),
  })).filter((g) => g.codes.length > 0);
}
