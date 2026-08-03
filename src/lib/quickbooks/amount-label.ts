// A ledger amount, written for a CLIENT to read.
//
// Not formatCurrency: these strings go into the label of a receipt-chase or
// "what was this?" checklist item, which is built server-side with no locale in
// hand — the client's own portal picks the language of everything around it.
// Keeping it plain also keeps the label stable if the client switches language,
// which matters because the label is stored on the row, not re-rendered.
//
// Shared because receipt-gap.ts and uncategorized.ts had byte-identical private
// copies of it. Both build the same kind of client-facing line, so a change to
// how an amount reads there has to reach both.
//
// The bare "$" fallback is deliberate: a ledger row with no currency recorded is
// the firm's own currency, and their client knows what that is. Where the
// currency IS known it is named rather than symbolised, because this string has
// no locale to disambiguate US$ from CA$.
export function formatLedgerAmount(
  n: number,
  currency: string | null,
): string {
  const s = n.toFixed(2);
  return currency ? `${s} ${currency}` : `$${s}`;
}
