// Journal-entry payloads for both ledgers (PURE, no I/O).
//
// The balanced entry is built upstream by payout-journal.ts; this only
// translates it into each provider's wire format. Kept pure so the shapes are
// unit-tested without touching a real ledger — a malformed journal payload is
// rejected wholesale by both APIs, and a SILENTLY wrong one (debits and
// credits swapped) corrupts a client's books.
//
// The two providers express the same idea very differently:
//
//   QuickBooks — every line carries an explicit PostingType ("Debit" /
//   "Credit") and a positive Amount, addressed by AccountRef.value (the
//   account id).
//
//   Xero — the SIGN of LineAmount carries the direction: positive is a debit,
//   negative is a credit. Lines are addressed by AccountCode, NOT the account
//   id, so the caller must supply an id -> code map. Narration is required and
//   there must be at least two lines.

import type { PayoutJournal } from "./payout-journal";

/** Cents -> the decimal both APIs expect, without float drift. */
export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

// ── QuickBooks ──────────────────────────────────────────────────────────────

export type QboJournalPayload = {
  TxnDate?: string;
  PrivateNote: string;
  Line: Array<{
    Description?: string;
    Amount: number;
    DetailType: "JournalEntryLineDetail";
    JournalEntryLineDetail: {
      PostingType: "Debit" | "Credit";
      AccountRef: { value: string };
    };
  }>;
};

export function buildQboJournalPayload(input: {
  journal: PayoutJournal;
  memo: string;
  /** ISO YYYY-MM-DD; omitted lets QuickBooks default to today. */
  txnDate: string | null;
}): QboJournalPayload {
  const Line = input.journal.lines.map((l) => {
    const debit = l.debitCents > 0;
    return {
      Description: l.description || undefined,
      Amount: centsToDecimal(debit ? l.debitCents : l.creditCents),
      DetailType: "JournalEntryLineDetail" as const,
      JournalEntryLineDetail: {
        PostingType: (debit ? "Debit" : "Credit") as "Debit" | "Credit",
        AccountRef: { value: l.account.id },
      },
    };
  });
  return {
    ...(input.txnDate ? { TxnDate: input.txnDate } : {}),
    // QuickBooks shows PrivateNote on the entry; it's how an accountant later
    // recognises which payout this was.
    PrivateNote: input.memo,
    Line,
  };
}

// ── Xero ────────────────────────────────────────────────────────────────────

export type XeroManualJournalPayload = {
  Narration: string;
  Date?: string;
  Status: "POSTED";
  JournalLines: Array<{
    LineAmount: number;
    AccountCode: string;
    Description?: string;
  }>;
};

export type BuildXeroJournalResult =
  | { ok: true; payload: XeroManualJournalPayload }
  // One or more accounts has no Xero code cached, so its line can't be
  // addressed. Refusing beats posting a partial (and therefore unbalanced)
  // journal, which Xero would reject anyway — but with a useless error.
  | { ok: false; reason: "missing_account_codes"; accountNames: string[] };

export function buildXeroJournalPayload(input: {
  journal: PayoutJournal;
  memo: string;
  txnDate: string | null;
  /** Xero AccountID -> AccountCode, from the cached account list. */
  codeByAccountId: Map<string, string>;
}): BuildXeroJournalResult {
  const missing: string[] = [];
  const JournalLines: XeroManualJournalPayload["JournalLines"] = [];

  for (const l of input.journal.lines) {
    const code = input.codeByAccountId.get(l.account.id);
    if (!code) {
      missing.push(l.account.name);
      continue;
    }
    JournalLines.push({
      // Xero's sign convention: positive debits, negative credits.
      LineAmount: centsToDecimal(
        l.debitCents > 0 ? l.debitCents : -l.creditCents,
      ),
      AccountCode: code,
      ...(l.description ? { Description: l.description } : {}),
    });
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_account_codes",
      accountNames: missing,
    };
  }

  return {
    ok: true,
    payload: {
      // Required by Xero, and the human label on the entry.
      Narration: input.memo,
      ...(input.txnDate ? { Date: input.txnDate } : {}),
      Status: "POSTED",
      JournalLines,
    },
  };
}

/**
 * The date to stamp the entry with: the payout's arrival date if known, else
 * the end of the period it covers. Null lets the ledger default to today
 * rather than inventing a date.
 */
export function journalDate(input: {
  payoutDate: string | null;
  periodEnd: string | null;
}): string | null {
  return input.payoutDate ?? input.periodEnd ?? null;
}
