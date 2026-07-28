// Payment-processor payout -> JOURNAL ENTRY (pure, side-effect-free).
//
// A payout statement can't be a Bill or an Invoice: one deposit represents
// several ledger movements at once. The entry an accountant books is
//
//     DEBIT   bank / clearing        net deposited
//     DEBIT   processing fees        fees
//     DEBIT   tax on fees            fee tax
//     DEBIT   refunds                refunds
//     DEBIT   chargebacks            adjustments
//       CREDIT  sales revenue                        gross
//
// THE SAFETY PROPERTY, and the reason this module can be trusted: those
// debits sum to gross exactly when the payout's figures ADD UP, because that
// is the same identity
//
//     gross − refunds − fees − feeTax − adjustments = net
//
// Rearranged: net + refunds + fees + feeTax + adjustments = gross. So a payout
// whose arithmetic holds ALWAYS balances, and one whose arithmetic is broken
// can never be made to balance by choosing different accounts.
// buildPayoutJournal therefore refuses to produce lines in that case — an
// unbalanced entry is never offered to a ledger, and the accountant is sent
// back to the discrepancy instead.
//
// Note the guard is the ARITHMETIC, not the payout's overall "reconciles"
// flag: that flag also goes false for advisories like a zero-or-negative
// payout, which is a legitimate refund-heavy month that books fine (the bank
// line simply becomes a credit).
//
// Everything here is integer CENTS. Money comparisons in floats produce
// phantom imbalances (0.1 + 0.2 !== 0.3), which in a journal entry means a
// rejected post or, worse, a silently wrong book.

import {
  RECONCILE_TOLERANCE_CENTS,
  reconcilePayout,
  toCents,
  type PayoutFigures,
} from "@/lib/ai/payout-reconcile";

export type AccountRef = { id: string; name: string };

// Which ledger account each part of the payout goes to. Only bank, sales and
// fees are REQUIRED; the rest fold into a fallback (see FOLD_INTO) so a firm
// that doesn't track refunds separately maps three accounts, once.
export type PayoutRole =
  | "bank"
  | "sales"
  | "fees"
  | "fee_tax"
  | "refunds"
  | "adjustments";

export type PayoutMapping = Partial<Record<PayoutRole, AccountRef | null>>;

export const REQUIRED_ROLES: PayoutRole[] = ["bank", "sales", "fees"];

// Where an unmapped role's amount goes instead. Fee tax joins the fee expense
// (the common small-firm treatment); refunds net against sales; chargebacks
// join fees. Each is a defensible default an accountant can override by
// mapping the role explicitly.
const FOLD_INTO: Record<
  Exclude<PayoutRole, "bank" | "sales" | "fees">,
  PayoutRole
> = {
  fee_tax: "fees",
  refunds: "sales",
  adjustments: "fees",
};

export type JournalLine = {
  role: PayoutRole;
  account: AccountRef;
  /** Exactly one of these is non-zero. */
  debitCents: number;
  creditCents: number;
  description: string;
};

export type PayoutJournal = {
  lines: JournalLine[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
};

export type BuildJournalResult =
  | { ok: true; journal: PayoutJournal }
  | {
      ok: false;
      reason:
        // The payout's own figures don't add up — fix that first; no choice
        // of accounts can rescue it.
        | "does_not_reconcile"
        // One or more of bank/sales/fees hasn't been mapped yet.
        | "missing_accounts"
        // Nothing to book (a fully zero statement).
        | "nothing_to_post";
      missingRoles?: PayoutRole[];
    };

/**
 * Which roles this payout actually needs an account for: always bank + sales,
 * plus any deduction that is present and non-zero. Drives both the UI (only
 * ask for what's needed) and the missing-account check.
 */
export function requiredRolesFor(figures: PayoutFigures): PayoutRole[] {
  const roles: PayoutRole[] = ["bank", "sales"];
  const fees = toCents(figures.fees) ?? 0;
  const feeTax = toCents(figures.feeTax) ?? 0;
  const adjustments = toCents(figures.adjustments) ?? 0;
  // Fee tax and adjustments fold into fees when unmapped, so the presence of
  // ANY of them makes a fees account necessary.
  if (fees !== 0 || feeTax !== 0 || adjustments !== 0) roles.push("fees");
  return roles;
}

function resolveAccount(
  role: PayoutRole,
  mapping: PayoutMapping,
): AccountRef | null {
  const direct = mapping[role];
  if (direct) return direct;
  if (role === "bank" || role === "sales" || role === "fees") return null;
  const fallback = FOLD_INTO[role];
  return mapping[fallback] ?? null;
}

/**
 * Build the journal. Returns lines only for a payout that RECONCILES and has
 * its required accounts mapped; anything else is an explicit refusal the
 * caller surfaces, never a best-effort entry.
 */
export function buildPayoutJournal(
  figures: PayoutFigures,
  mapping: PayoutMapping,
): BuildJournalResult {
  // 1. The payout's own ARITHMETIC must hold — the guard that makes the
  //    balance property above true rather than hopeful.
  //
  //    Deliberately NOT `reconciles`: that flag is false whenever there is
  //    anything worth telling a human, including the advisory "this payout is
  //    zero or negative" on a legitimately refund-heavy month. Such a month
  //    books perfectly well (the bank line simply becomes a credit), so
  //    gating on it would refuse correct entries. What matters here is only
  //    whether the figures add up.
  const check = reconcilePayout(figures);
  const arithmeticHolds =
    check.differenceCents != null &&
    Math.abs(check.differenceCents) <= RECONCILE_TOLERANCE_CENTS;
  if (!arithmeticHolds) {
    return { ok: false, reason: "does_not_reconcile" };
  }

  const gross = toCents(figures.grossSales);
  const net = toCents(figures.netPayout);
  if (gross == null || net == null) {
    return { ok: false, reason: "does_not_reconcile" };
  }

  const refunds = toCents(figures.refunds) ?? 0;
  const fees = toCents(figures.fees) ?? 0;
  const feeTax = toCents(figures.feeTax) ?? 0;
  const adjustments = toCents(figures.adjustments) ?? 0;

  if (gross === 0 && net === 0 && refunds === 0 && fees === 0) {
    return { ok: false, reason: "nothing_to_post" };
  }

  // 2. Every role that carries money needs an account (directly or by fold).
  const missingRoles = requiredRolesFor(figures).filter(
    (r) => resolveAccount(r, mapping) == null,
  );
  if (missingRoles.length > 0) {
    return { ok: false, reason: "missing_accounts", missingRoles };
  }

  // 3. Assemble. Amounts are accumulated PER ACCOUNT so folded roles merge
  //    into one line rather than producing two lines on the same account
  //    (which some ledgers reject and every accountant finds ugly).
  const byAccount = new Map<
    string,
    { role: PayoutRole; account: AccountRef; cents: number; parts: string[] }
  >();

  const add = (
    role: PayoutRole,
    cents: number,
    label: string,
    /** true = debit, false = credit */
    debit: boolean,
  ) => {
    if (cents === 0) return;
    const account = resolveAccount(role, mapping);
    if (!account) return; // unreachable: checked above
    const signed = debit ? cents : -cents;
    const existing = byAccount.get(account.id);
    if (existing) {
      existing.cents += signed;
      existing.parts.push(label);
      return;
    }
    byAccount.set(account.id, {
      role,
      account,
      cents: signed,
      parts: [label],
    });
  };

  // The deposit. A NEGATIVE payout (refund-heavy period) means money left the
  // bank, so the line flips to a credit — handled by the sign, not a branch.
  add("bank", Math.abs(net), "Net payout", net >= 0);
  add("fees", fees, "Processing fees", true);
  add("fee_tax", feeTax, "Tax on fees", true);
  add("refunds", refunds, "Refunds", true);
  add("adjustments", adjustments, "Chargebacks & adjustments", true);
  // Revenue at GROSS — the whole point of the split.
  add("sales", gross, "Gross sales", false);

  const lines: JournalLine[] = [];
  for (const entry of byAccount.values()) {
    // A folded account can net out to zero (e.g. refunds folded into sales
    // exactly cancelling it); drop those rather than post a zero line.
    if (entry.cents === 0) continue;
    lines.push({
      role: entry.role,
      account: entry.account,
      debitCents: entry.cents > 0 ? entry.cents : 0,
      creditCents: entry.cents < 0 ? -entry.cents : 0,
      description: entry.parts.join(" + "),
    });
  }

  const totalDebitCents = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCreditCents = lines.reduce((s, l) => s + l.creditCents, 0);

  return {
    ok: true,
    journal: {
      lines,
      totalDebitCents,
      totalCreditCents,
      balanced: totalDebitCents === totalCreditCents,
    },
  };
}

/** A one-line memo for the ledger entry. */
export function journalMemo(input: {
  processor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}): string {
  const who = input.processor?.trim() || "Payment processor";
  if (input.periodStart && input.periodEnd) {
    return `${who} payout ${input.periodStart} to ${input.periodEnd}`;
  }
  const one = input.periodEnd ?? input.periodStart;
  return one ? `${who} payout ${one}` : `${who} payout`;
}
