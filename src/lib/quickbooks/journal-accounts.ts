// Which accounts a ledger will ACCEPT in a journal entry (pure, no I/O).
//
// The two ledgers disagree, and Xero's disagreement is absolute:
//
//   QuickBooks — a journal entry may debit or credit anything, bank accounts
//   included. Nothing to filter.
//
//   Xero — a manual journal may NOT touch a bank, accounts-receivable or
//   accounts-payable balance. Those balances are reserved for the documents
//   that own them (bank transactions, invoices, bills), so that a bank account
//   in Xero always mirrors the real bank account and stays reconcilable. Xero
//   rejects the whole journal with a 400 ValidationException.
//
//   Xero's own prescribed workaround is a CLEARING (or suspense) account: the
//   journal books the deposit to the clearing account, and the real bank
//   deposit is later reconciled against it. That is why the deposit role is
//   labelled differently for Xero — see the section component.
//
// This module is the single place that knows the rule, so the picker (which
// hides what can't work) and the posting path (which refuses before calling
// the API) can never drift apart.

import type { PayoutRole } from "./payout-journal";

export type LedgerProvider = "quickbooks" | "xero";

/** An account as both the picker and the posting path see it. */
export type TypedAccount = {
  id: string;
  name: string;
  /** Normalized type from the cache (normalizeXeroAccountType / QuickBooks). */
  type: string | null;
};

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

/**
 * Accounts Xero refuses in a manual journal, by normalized type.
 *
 * Bank and credit-card accounts are the ones we can identify with certainty
 * from the cached type. Xero also refuses its accounts-receivable and
 * accounts-payable control accounts, but those carry ordinary CURRENT /
 * CURRLIAB types and are only distinguishable by Xero's SystemAccount field,
 * which the cache doesn't store. Those stay unfiltered here and are caught by
 * the API's own validation, which is now reported verbatim (see
 * describeXeroFailure in lib/xero/write.ts) rather than truncated away.
 */
const XERO_BLOCKED_TYPES = ["bank", "credit card"];

/** Can this account be a line on a journal entry in this ledger? */
export function isJournalAccountAllowed(
  provider: LedgerProvider,
  accountType: string | null | undefined,
): boolean {
  if (provider !== "xero") return true;
  return !XERO_BLOCKED_TYPES.includes(lower(accountType));
}

/**
 * The names of accounts on an already-built entry that this ledger will
 * refuse. Empty means the entry is safe to send.
 *
 * An account whose type ISN'T known (not in the cache) is never reported —
 * absence of evidence is not evidence of a bank account, and a false refusal
 * would block a legitimate entry with no way around it.
 */
export function blockedJournalAccounts(
  provider: LedgerProvider,
  accounts: { id: string; name: string }[],
  typeById: Map<string, string | null>,
): string[] {
  if (provider !== "xero") return [];
  const names: string[] = [];
  for (const a of accounts) {
    if (!typeById.has(a.id)) continue;
    if (isJournalAccountAllowed(provider, typeById.get(a.id))) continue;
    if (!names.includes(a.name)) names.push(a.name);
  }
  return names;
}

/**
 * Whether an account is the OBVIOUS choice for a role — used to sort the
 * picker, never to restrict it. A firm's chart of accounts is theirs; the
 * suggestion just stops the common mis-pick (booking processing fees to a
 * revenue account) without overriding an accountant's judgment.
 */
export function isSuggestedForRole(
  role: PayoutRole,
  provider: LedgerProvider,
  account: TypedAccount,
): boolean {
  const t = lower(account.type);
  const name = lower(account.name);
  const income = t.includes("income") || t.includes("revenue");
  const expense = t.includes("expense") || t.includes("cost of goods");

  switch (role) {
    case "sales":
    case "refunds":
      return income;
    case "fees":
    case "fee_tax":
    case "adjustments":
      return expense;
    case "bank":
      // Xero can't use the real bank account here, so the target is a
      // clearing/suspense account — matched BY NAME only.
      //
      // Suggesting every CURRENT / CURRLIAB account (the first attempt at
      // this) was actively harmful: in Xero's own default chart that puts
      // Accounts Receivable and Accounts Payable at the top of the list, and
      // those are precisely the other two balances Xero refuses in a manual
      // journal. The suggestion would have walked the accountant into the
      // next rejection. When a firm has no clearing account, suggesting
      // NOTHING is correct — they pick from the full list knowing they chose.
      if (provider === "xero") {
        return /clear|suspen|undeposit|holding/.test(name);
      }
      return t === "bank" || t === "credit card" || t.includes("current asset");
  }
}

/**
 * Split a chart of accounts for one role's picker: what the ledger allows,
 * suggested first. `blocked` is returned so the UI can say WHY an account the
 * accountant expects to see isn't there, instead of silently omitting it.
 */
export function accountsForRole(
  role: PayoutRole,
  provider: LedgerProvider,
  accounts: TypedAccount[],
): { suggested: TypedAccount[]; others: TypedAccount[]; blocked: number } {
  const suggested: TypedAccount[] = [];
  const others: TypedAccount[] = [];
  let blocked = 0;
  for (const a of accounts) {
    if (!isJournalAccountAllowed(provider, a.type)) {
      blocked += 1;
      continue;
    }
    (isSuggestedForRole(role, provider, a) ? suggested : others).push(a);
  }
  return { suggested, others, blocked };
}
