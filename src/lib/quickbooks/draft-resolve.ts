// QuickBooks Stage 4 — effective mapping (pure).
//
// A draft has TWO layers: the AI `suggestion` (a starting point) and the
// accountant's `resolved` picks (what they actually chose). The EFFECTIVE value
// of each field is "what the accountant picked, else what the AI matched". This
// is the single source of truth the card displays and the roll-up counts, so
// editing a draft and reading it back always agree.

import type {
  TransactionSuggestion,
  ResolvedEntry,
  ResolvedRef,
} from "@/lib/quickbooks/suggest";

export type EffectiveMapping = {
  party: ResolvedRef | null;
  account: ResolvedRef | null;
  taxCode: ResolvedRef | null;
  // The product/service item for an income line (Invoice). Null for expenses.
  item: ResolvedRef | null;
  // The bank/credit-card account a PAID expense (Purchase) was paid from. Null for
  // income and for unpaid expenses (Bills).
  paymentAccount: ResolvedRef | null;
};

function matchRef(m: { id: string; name: string } | null): ResolvedRef | null {
  return m ? { id: m.id, name: m.name } : null;
}

// The accountant's pick wins; otherwise fall back to the AI's confident match.
// `item` / `paymentAccount` are defensive about older suggestions/resolved rows
// that predate income / Purchase support (those fields may be absent).
export function effectiveMapping(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): EffectiveMapping {
  return {
    party: resolved?.party ?? matchRef(suggestion.party.match),
    account: resolved?.account ?? matchRef(suggestion.account.match),
    taxCode: resolved?.taxCode ?? matchRef(suggestion.taxCode.match),
    item: resolved?.item ?? matchRef(suggestion.item?.match ?? null),
    paymentAccount:
      resolved?.paymentAccount ??
      matchRef(suggestion.paymentAccount?.match ?? null),
  };
}

// A date QuickBooks can actually post: ISO YYYY-MM-DD AND a real calendar date.
// Two invalid-but-non-null sources exist, so a bare null check isn't enough: the
// AI's extracted date may be non-ISO ("as printed", e.g. "03/14/2024") and a
// hand-crafted resolved.date could be structurally-valid-but-impossible
// ("2024-13-40"). Both would post a date QuickBooks rejects.
export function isPostableDate(d: string | null | undefined): boolean {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  // Round-trip through UTC: an impossible date (month 13, Feb 30) normalizes to a
  // different day, so the re-serialized value won't equal the input.
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

// The transaction date to post: the accountant's override, else the AI's read —
// but ONLY when it's a postable ISO date. A non-ISO / impossible value is coerced
// to null so the draft is flagged (amber) and BLOCKED, rather than silently
// posting a date QuickBooks rejects (or dating it "today", which breaks bank-feed
// auto-matching).
export function effectiveDate(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): string | null {
  const raw = resolved?.date ?? suggestion.date ?? null;
  return isPostableDate(raw) ? raw : null;
}

// One effective expense line for a split post: its description + pre-tax amount +
// the effective account (the accountant's pick, else the AI's per-line match).
export type EffectiveLine = {
  description: string;
  amount: number;
  account: ResolvedRef | null;
};

// The per-line accounts to use when splitting: the accountant's pick for a line
// (resolved.lineAccounts["i"]) else the AI's suggested account for it. Empty when
// the suggestion has no reconciled lines.
export function effectiveLines(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): EffectiveLine[] {
  const lines = suggestion.lines ?? [];
  return lines.map((l, i) => {
    const override = resolved?.lineAccounts?.[String(i)];
    return {
      description: l.description,
      amount: l.amount,
      // `override` may be an explicit null (cleared) — only fall back to the AI
      // match when the accountant hasn't touched this line at all (undefined).
      account: override !== undefined ? override : matchRef(l.account.match),
    };
  });
}

// Is this expense draft effectively SPLIT across accounts? Only when it has ≥2
// reconciled line items AND the accountant opted in (resolved.split). Default is
// single-line (no behavior change) — a multi-item receipt for one account never
// forces per-line work unless the accountant asks. Income/unknown never split.
export function effectiveSplit(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): boolean {
  if (suggestion.direction !== "expense") return false;
  const canSplit = (suggestion.lines?.length ?? 0) >= 2;
  return canSplit && (resolved?.split ?? false);
}

// How an EXPENSE should post: a PAID receipt is a QuickBooks "Purchase" (against a
// bank/credit-card account), an unpaid bill is a "Bill". The accountant's override
// wins; otherwise the AI's read; default to "bill" (today's behavior) when unknown
// so nothing silently changes for a document we can't classify. Income is never a
// Purchase; "purchase" only applies to expense/unknown directions.
export function effectiveExpenseMode(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): "bill" | "purchase" {
  // Only a genuine EXPENSE can be a Purchase. Income (n/a) and unknown-direction
  // drafts stay "bill" — the paid toggle + paid-from picker are expense-only in
  // the UI, so an unknown+paid draft must never demand a paid-from account it has
  // no way to set (which would make it permanently non-approvable).
  if (suggestion.direction !== "expense") return "bill";
  const paid = resolved?.paid ?? suggestion.paid ?? false;
  return paid ? "purchase" : "bill";
}

// The income-side mirror of effectiveExpenseMode: a PAID sale posts a QuickBooks
// "SalesReceipt" (income already received), an unpaid one an "Invoice" (the
// customer still owes). Non-income directions are never a sales receipt. Default
// to "invoice" (today's behavior) when unknown, so income only becomes a
// SalesReceipt once the accountant marks it paid — reuses the SAME `paid`
// override as the expense toggle.
export function effectiveIncomeMode(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): "invoice" | "salesreceipt" {
  if (suggestion.direction !== "income") return "invoice";
  const paid = resolved?.paid ?? suggestion.paid ?? false;
  return paid ? "salesreceipt" : "invoice";
}

// Does this draft still need the accountant's input before it could be posted?
// Party always matters; the "mapping target" differs by direction — an INCOME
// line needs an ITEM (Invoice lines post to an item), an expense needs an
// ACCOUNT (Bill lines post to an account). The tax code matters only when the
// document showed tax. A foreign currency or a missing total also flag. Used by
// the roll-up and to tint the card.
export function draftNeedsInput(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): boolean {
  const eff = effectiveMapping(suggestion, resolved);
  const hasTax = suggestion.taxTotal != null;
  // Mapping target by direction: income needs an ITEM; an expense needs an
  // ACCOUNT, and when it's a PAID expense (Purchase) it ALSO needs the bank/credit-
  // card account it was paid from.
  let mappingMissing: boolean;
  if (suggestion.direction === "income") {
    mappingMissing = eff.item == null;
  } else {
    const isPurchase =
      effectiveExpenseMode(suggestion, resolved) === "purchase";
    // A SPLIT expense needs EVERY line's account chosen; otherwise the single
    // expense account. A Purchase also needs the paid-from account either way.
    const accountMissing = effectiveSplit(suggestion, resolved)
      ? effectiveLines(suggestion, resolved).some((l) => l.account == null)
      : eff.account == null;
    mappingMissing =
      accountMissing || (isPurchase && eff.paymentAccount == null);
  }
  return (
    eff.party == null ||
    mappingMissing ||
    (hasTax && eff.taxCode == null) ||
    (suggestion.currency != null && suggestion.currency !== "CAD") ||
    suggestion.amount == null ||
    // A date is required so QuickBooks can auto-match this to the bank feed
    // instead of posting it dated "today".
    effectiveDate(suggestion, resolved) == null
  );
}
