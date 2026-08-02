// Bank reconciliation, as one comparison per account per month:
//
//     what the BOOKS say the account held at month end
//     vs what the BANK STATEMENT says it held
//
// The books half is read live from QuickBooks/Xero. The statement half is the
// one number the firm types (no ledger API hands out a client's statement
// balance). Everything below is pure so the rule that decides the word
// "reconciled" is testable and lives in exactly one place.
//
// THE RULE, AND IT IS THE WHOLE FILE: an account is reconciled only when BOTH
// numbers are known AND equal. Anything else is "unknown" or "off" — never
// clean. This board already refuses to print a 0 that could mean "nobody
// looked"; a green tick that could mean "nobody typed the statement balance"
// would be the same lie with a better disguise, and it would be attached to
// the step that says the books are right.

// Money is integer cents everywhere. Never a float: 0.1 + 0.2 is famously not
// 0.3, and a reconciliation that is wrong by a rounding error is a
// reconciliation that reports a difference forever.
export type ReconAccount = {
  accountId: string;
  name: string;
  kind: "bank" | "credit_card";
  // From the ledger. null = we could not read it (no connection, API refused,
  // provider not supported yet) — NOT zero.
  bookBalanceCents: number | null;
  // What the firm typed for this month. null = nobody has entered it yet.
  statementBalanceCents: number | null;
};

export type ReconStatus =
  | { kind: "reconciled" }
  // Both numbers known and they disagree. `differenceCents` is books minus
  // statement, signed: positive means the books hold MORE than the bank says.
  | { kind: "off"; differenceCents: number }
  // Why we cannot answer, so the UI can say the useful thing rather than a
  // shrug: ask for the statement balance, or report that the books could not
  // be read.
  | { kind: "unknown"; missing: "statement" | "books" | "both" };

export function reconcileAccount(account: ReconAccount): ReconStatus {
  const haveBooks = account.bookBalanceCents != null;
  const haveStatement = account.statementBalanceCents != null;
  if (!haveBooks || !haveStatement) {
    return {
      kind: "unknown",
      missing: !haveBooks && !haveStatement ? "both" : !haveBooks ? "books" : "statement",
    };
  }
  const difference = account.bookBalanceCents! - account.statementBalanceCents!;
  return difference === 0 ? { kind: "reconciled" } : { kind: "off", differenceCents: difference };
}

export type ReconSummary = {
  total: number;
  reconciled: number;
  off: number;
  unknown: number;
  // The largest single discrepancy, by absolute size — what a firm wants to
  // look at first when several accounts disagree. Null when none are off.
  largestDifferenceCents: number | null;
};

// Roll one client's accounts into the single line the close board shows.
export function summarizeReconciliation(
  accounts: ReconAccount[],
): ReconSummary {
  const summary: ReconSummary = {
    total: accounts.length,
    reconciled: 0,
    off: 0,
    unknown: 0,
    largestDifferenceCents: null,
  };
  for (const account of accounts) {
    const status = reconcileAccount(account);
    if (status.kind === "reconciled") summary.reconciled++;
    else if (status.kind === "unknown") summary.unknown++;
    else {
      summary.off++;
      const biggest = summary.largestDifferenceCents;
      if (biggest == null || Math.abs(status.differenceCents) > Math.abs(biggest)) {
        summary.largestDifferenceCents = status.differenceCents;
      }
    }
  }
  return summary;
}

// Is this client's bank reconciliation actually finished for the month?
//
// Deliberately strict: every account reconciled, and at least one account to
// reconcile. A client whose accounts we could not read comes back false, so
// "no accounts found" can never masquerade as "all done" — the failure mode
// that would quietly bless an unreconciled month.
export function isFullyReconciled(summary: ReconSummary): boolean {
  return summary.total > 0 && summary.reconciled === summary.total;
}
