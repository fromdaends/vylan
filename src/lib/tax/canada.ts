// Canada-wide sales-tax engine for native invoices — the ONE place province →
// tax components → rates lives. A provincial rate change is a one-line edit
// here. Rates verified against official sources 2026-07 (Nova Scotia's HST cut
// to 14% took effect 2025-04-01).
//
// Design rules (locked in Phase 0):
//   * Every component calculates on the SUBTOTAL — including Quebec, where QST
//     has been computed on the price excluding GST since 2013. No compounding.
//   * Rates are integers in "milli-percent" (thousandths of a percent):
//     5% = 5000, 9.975% = 9975, 13% = 13000. All tax math stays in integers:
//     amount = round(base_cents * rate_milli_pct / 100000).
//   * Each component is individually toggleable per invoice (whether a tax
//     applies to a given service is the accountant's professional call — Vylan
//     supplies machinery and defaults, never tax advice). Rates are NOT
//     editable per invoice.
//   * Labels live here (not in messages/*.json) because the PDF renderer and
//     the tax_breakdown snapshot need them server-side in both languages.

export type ProvinceCode =
  | "AB"
  | "BC"
  | "MB"
  | "NB"
  | "NL"
  | "NS"
  | "NT"
  | "NU"
  | "ON"
  | "PE"
  | "QC"
  | "SK"
  | "YT";

export const PROVINCE_CODES: readonly ProvinceCode[] = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
];

export function isProvinceCode(v: unknown): v is ProvinceCode {
  return (
    typeof v === "string" && (PROVINCE_CODES as readonly string[]).includes(v)
  );
}

// GST and HST share one registration (the federal GST/HST account). QST is
// Quebec's own registration; PST covers BC/SK PST and Manitoba's RST.
export type RegistrationKind = "gst" | "qst" | "pst";

export type TaxComponentId = "GST" | "HST" | "QST" | "PST" | "RST";

export type TaxComponent = {
  id: TaxComponentId;
  // Thousandths of a percent: 5% = 5000, 9.975% = 9975, 13% = 13000.
  rateMilliPct: number;
  registrationKind: RegistrationKind;
};

const GST: TaxComponent = { id: "GST", rateMilliPct: 5000, registrationKind: "gst" };
const QST: TaxComponent = { id: "QST", rateMilliPct: 9975, registrationKind: "qst" };

function hst(rateMilliPct: number): TaxComponent {
  return { id: "HST", rateMilliPct, registrationKind: "gst" };
}
function pst(rateMilliPct: number): TaxComponent {
  return { id: "PST", rateMilliPct, registrationKind: "pst" };
}

// The full map. HST provinces bill ONE combined line; GST+PST provinces bill
// two; Quebec bills GST + QST (both on the subtotal); AB + the territories
// bill GST only.
export const PROVINCE_TAXES: Record<ProvinceCode, readonly TaxComponent[]> = {
  AB: [GST],
  BC: [GST, pst(7000)],
  MB: [GST, { id: "RST", rateMilliPct: 7000, registrationKind: "pst" }],
  NB: [hst(15000)],
  NL: [hst(15000)],
  NS: [hst(14000)], // 14% since 2025-04-01 (was 15%)
  NT: [GST],
  NU: [GST],
  ON: [hst(13000)],
  PE: [hst(15000)],
  QC: [GST, QST],
  SK: [GST, pst(6000)],
  YT: [GST],
};

// ── Labels (server-safe, both languages) ────────────────────────────────────

const COMPONENT_LABELS: Record<TaxComponentId, { en: string; fr: string }> = {
  GST: { en: "GST", fr: "TPS" },
  HST: { en: "HST", fr: "TVH" },
  QST: { en: "QST", fr: "TVQ" },
  PST: { en: "PST", fr: "TVP" },
  RST: { en: "RST", fr: "TVD" },
};

// "GST (5%)" / "TVQ (9,975 %)" — the label as it appears on the invoice line.
export function taxComponentLabel(
  component: Pick<TaxComponent, "id" | "rateMilliPct">,
  locale: "en" | "fr",
): string {
  const name = COMPONENT_LABELS[component.id][locale];
  const rate = formatRateMilliPct(component.rateMilliPct, locale);
  return locale === "fr" ? `${name} (${rate} %)` : `${name} (${rate}%)`;
}

// 5000 → "5" · 9975 → "9.975" (en) / "9,975" (fr) · 14000 → "14".
export function formatRateMilliPct(
  rateMilliPct: number,
  locale: "en" | "fr",
): string {
  const s = (rateMilliPct / 1000).toString();
  return locale === "fr" ? s.replace(".", ",") : s;
}

const PROVINCE_NAMES: Record<ProvinceCode, { en: string; fr: string }> = {
  AB: { en: "Alberta", fr: "Alberta" },
  BC: { en: "British Columbia", fr: "Colombie-Britannique" },
  MB: { en: "Manitoba", fr: "Manitoba" },
  NB: { en: "New Brunswick", fr: "Nouveau-Brunswick" },
  NL: { en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador" },
  NS: { en: "Nova Scotia", fr: "Nouvelle-Écosse" },
  NT: { en: "Northwest Territories", fr: "Territoires du Nord-Ouest" },
  NU: { en: "Nunavut", fr: "Nunavut" },
  ON: { en: "Ontario", fr: "Ontario" },
  PE: { en: "Prince Edward Island", fr: "Île-du-Prince-Édouard" },
  QC: { en: "Quebec", fr: "Québec" },
  SK: { en: "Saskatchewan", fr: "Saskatchewan" },
  YT: { en: "Yukon", fr: "Yukon" },
};

export function provinceName(code: ProvinceCode, locale: "en" | "fr"): string {
  return PROVINCE_NAMES[code][locale];
}

// ── Calculation ─────────────────────────────────────────────────────────────

export type TaxLine = {
  component: TaxComponentId;
  rateMilliPct: number;
  registrationKind: RegistrationKind;
  baseCents: number;
  amountCents: number;
};

// One tax line, rounded half-up to the cent on the subtotal. Integer-only.
export function taxAmountCents(
  baseCents: number,
  rateMilliPct: number,
): number {
  return Math.round((baseCents * rateMilliPct) / 100_000);
}

// Compute the tax lines for a subtotal in one province. `enabled` filters
// components by the per-invoice toggles (omit it for "all on"). Rounding rule
// (locked): round EACH component to the cent, then sum — what the client sees
// per line is exactly what is charged in total.
export function computeTaxLines(
  subtotalCents: number,
  province: ProvinceCode,
  enabled?: (id: TaxComponentId) => boolean,
): TaxLine[] {
  return PROVINCE_TAXES[province]
    .filter((c) => (enabled ? enabled(c.id) : true))
    .map((c) => ({
      component: c.id,
      rateMilliPct: c.rateMilliPct,
      registrationKind: c.registrationKind,
      baseCents: subtotalCents,
      amountCents: taxAmountCents(subtotalCents, c.rateMilliPct),
    }));
}

export function sumTaxCents(lines: readonly TaxLine[]): number {
  return lines.reduce((acc, l) => acc + l.amountCents, 0);
}
