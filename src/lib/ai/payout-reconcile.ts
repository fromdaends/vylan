// Payment-processor payout reconciliation — PURE, code-side verdicts.
//
// The model TRANSCRIBES what a Stripe / Square / PayPal / Shopify payout
// statement prints (see processor-payout.ts). Every DECISION lives here, in
// integer cents, so a finding is a checked fact rather than an opinion. Fourth
// use of the pattern that has served this codebase well: page counts, the
// duplicate guard, statement balance chaining, and now payouts.
//
// The core identity a payout statement must satisfy:
//
//     gross sales - refunds - fees - adjustments = net deposited
//
// When it holds, the accountant can book the split with confidence. When it
// doesn't, something was misread or the statement carries a line we didn't
// capture — either way we say so plainly and NEVER invent the missing piece.

export type PayoutFinding = {
  code: "does_not_reconcile" | "missing_figures" | "net_not_positive";
  label_en: string;
  label_fr: string;
  detail_en: string;
  detail_fr: string;
};

// The transcribed figures, in DOLLARS as printed (null = not clearly legible).
export type PayoutFigures = {
  grossSales: number | null;
  refunds: number | null;
  fees: number | null;
  /** Tax charged ON the processor's fee (GST/HST on Stripe fees, etc.). */
  feeTax: number | null;
  /** Chargebacks, reserves, holds, and any other named deduction. */
  adjustments: number | null;
  netPayout: number | null;
};

// Money is compared in integer CENTS — never floats. 0.1 + 0.2 !== 0.3 would
// otherwise produce phantom "doesn't reconcile" findings on clean statements.
export function toCents(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

// Statements round their own subtotals, so allow a one-cent drift before
// calling a mismatch. Anything larger is a real discrepancy worth a human.
export const RECONCILE_TOLERANCE_CENTS = 1;

function money(cents: number, locale: "en" | "fr"): string {
  const v = Math.abs(centsToAmount(cents)).toFixed(2);
  return locale === "fr" ? `${v.replace(".", ",")} $` : `$${v}`;
}

export type PayoutReconciliation = {
  /** True only when every figure needed was present AND the math holds. */
  reconciles: boolean;
  findings: PayoutFinding[];
  /** The computed expected net (cents), when enough figures were present. */
  expectedNetCents: number | null;
  /** Signed difference: actual net minus expected net (cents). */
  differenceCents: number | null;
};

/**
 * Check the payout identity. Missing figures are reported as missing, never
 * treated as zero — a statement whose fee line we couldn't read must not
 * silently "reconcile" by pretending the fee was nothing.
 */
export function reconcilePayout(f: PayoutFigures): PayoutReconciliation {
  const gross = toCents(f.grossSales);
  const net = toCents(f.netPayout);
  // Refunds / fees / adjustments are OPTIONAL concepts: a statement with no
  // refunds legitimately prints nothing. The model returns 0 when the line is
  // present and zero, null when it couldn't read it. Only gross and net are
  // structurally required to check anything at all.
  const refunds = toCents(f.refunds) ?? 0;
  const fees = toCents(f.fees) ?? 0;
  const feeTax = toCents(f.feeTax) ?? 0;
  const adjustments = toCents(f.adjustments) ?? 0;

  const findings: PayoutFinding[] = [];

  if (gross == null || net == null) {
    findings.push({
      code: "missing_figures",
      label_en: "Payout figures incomplete",
      label_fr: "Chiffres du versement incomplets",
      detail_en:
        "The gross sales or the net deposited amount could not be read, so the split can't be checked.",
      detail_fr:
        "Les ventes brutes ou le montant net déposé n'ont pas pu être lus; la répartition ne peut pas être vérifiée.",
    });
    return {
      reconciles: false,
      findings,
      expectedNetCents: null,
      differenceCents: null,
    };
  }

  const expected = gross - refunds - fees - feeTax - adjustments;
  const difference = net - expected;

  if (Math.abs(difference) > RECONCILE_TOLERANCE_CENTS) {
    findings.push({
      code: "does_not_reconcile",
      label_en: "Payout doesn't add up",
      label_fr: "Le versement ne balance pas",
      detail_en: `Gross minus refunds, fees and adjustments comes to ${money(expected, "en")}, but the statement says ${money(net, "en")} was deposited — a difference of ${money(difference, "en")}. A line may be missing or misread.`,
      detail_fr: `Le brut moins les remboursements, frais et ajustements donne ${money(expected, "fr")}, mais le relevé indique un dépôt de ${money(net, "fr")} — un écart de ${money(difference, "fr")}. Une ligne est peut-être manquante ou mal lue.`,
    });
  }

  // A negative or zero payout is legitimate (a period of heavy refunds), but
  // it's unusual enough that the accountant should see it flagged rather than
  // book it as ordinary revenue.
  if (net <= 0) {
    findings.push({
      code: "net_not_positive",
      label_en: "No money was deposited",
      label_fr: "Aucun montant déposé",
      detail_en:
        "This period's payout is zero or negative — usually refunds or chargebacks exceeded sales. Worth confirming before booking.",
      detail_fr:
        "Le versement de cette période est nul ou négatif — habituellement des remboursements ou rétrofacturations supérieurs aux ventes. À confirmer avant comptabilisation.",
    });
  }

  return {
    reconciles: findings.length === 0,
    findings,
    expectedNetCents: expected,
    differenceCents: difference,
  };
}

// ── The booking split (what an accountant would actually record) ────────────

export type PayoutSplitLine = {
  kind: "sales" | "refunds" | "fees" | "fee_tax" | "adjustments" | "net";
  /** Positive dollars; `kind` carries the direction. */
  amount: number;
  label_en: string;
  label_fr: string;
};

/**
 * Turn the figures into the lines an accountant books: revenue at GROSS, the
 * processor's fee as an expense, refunds against revenue, and the net as what
 * actually hit the bank. Omits lines that are absent or zero, so a simple
 * payout renders as two lines rather than six empty ones.
 */
export function buildPayoutSplit(f: PayoutFigures): PayoutSplitLine[] {
  const rows: Array<{
    kind: PayoutSplitLine["kind"];
    cents: number | null;
    label_en: string;
    label_fr: string;
  }> = [
    {
      kind: "sales",
      cents: toCents(f.grossSales),
      label_en: "Gross sales",
      label_fr: "Ventes brutes",
    },
    {
      kind: "refunds",
      cents: toCents(f.refunds),
      label_en: "Refunds",
      label_fr: "Remboursements",
    },
    {
      kind: "fees",
      cents: toCents(f.fees),
      label_en: "Processing fees",
      label_fr: "Frais de traitement",
    },
    {
      kind: "fee_tax",
      cents: toCents(f.feeTax),
      label_en: "Tax on fees",
      label_fr: "Taxes sur les frais",
    },
    {
      kind: "adjustments",
      cents: toCents(f.adjustments),
      label_en: "Chargebacks & adjustments",
      label_fr: "Rétrofacturations et ajustements",
    },
    {
      kind: "net",
      cents: toCents(f.netPayout),
      label_en: "Deposited to bank",
      label_fr: "Déposé à la banque",
    },
  ];

  return rows
    .filter((r) => r.cents != null && (r.kind === "net" || r.cents !== 0))
    .map((r) => ({
      kind: r.kind,
      amount: centsToAmount(r.cents as number),
      label_en: r.label_en,
      label_fr: r.label_fr,
    }));
}
