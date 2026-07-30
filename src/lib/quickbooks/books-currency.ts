// What currency a connected set of books can EXPRESS on a posted transaction.
//
// This feeds TransactionSuggestion.booksCurrency, and null there means "we cannot
// state a currency" — which is exactly when a foreign-currency document must stop
// and wait rather than post at face value in whatever the books use.
//
// The two providers earn a non-null answer differently, and that asymmetry is the
// whole point of keeping this in one place:
//
//   Xero        knowing the organisation's currency is enough. Xero always
//               accepts a CurrencyCode on the transaction.
//   QuickBooks  knowing the home currency is NOT enough. QuickBooks refuses a
//               CurrencyRef unless multicurrency is switched on for the company,
//               so both facts are required.

export function quickbooksBooksCurrency(prefs: {
  homeCurrency: string | null;
  multicurrencyEnabled: boolean | null;
}): string | null {
  // Multicurrency off, or never read: the post cannot state a currency, so a
  // foreign document stays blocked. `false` and `null` behave the same here, but
  // they are different facts and the system-check page reports them differently.
  if (prefs.multicurrencyEnabled !== true) return null;
  const c = prefs.homeCurrency?.trim().toUpperCase();
  return c || null;
}
