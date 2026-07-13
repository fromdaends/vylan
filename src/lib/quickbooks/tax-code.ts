// A QuickBooks "adjustment" tax code (e.g. "GST/HST Adjustment", "QST
// Adjustment", or the French "Ajustement de la TPS/TVH") is a tax-centre filing
// adjustment code — it has no purchase/sales rate. QuickBooks rejects it as the
// tax basis on a normal transaction line ("QuickBooks encountered an error while
// calculating tax", ValidationFault code 6000), so it must never be offered as a
// selectable tax code on a draft.
//
// This is a NAME heuristic (QuickBooks names these codes consistently), used
// until the cached tax-code list carries QuickBooks' purchase/sales applicability
// flags. It deliberately does NOT exclude exempt / zero-rated / out-of-scope
// codes — those are valid (0%) on purchases.
export function isAdjustmentTaxCode(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("adjustment") || n.includes("ajustement");
}

// Whether a tax code may be selected on / posted with a draft.
export function isSelectableTaxCode(name: string): boolean {
  return !isAdjustmentTaxCode(name);
}
