// Sage 50 export — pure preview logic.
//
// Given the documents in one engagement, decide what a Sage CSV export WOULD
// contain, BEFORE any file is generated: which documents carry a bookkeeping
// transaction (and so will be exported), which are skipped and why, and which
// carry a low-confidence extraction the accountant should double-check.
//
// This mirrors the QuickBooks extraction gate (shouldExtractTransaction): a
// document is a transaction document iff it is a receipt or a sales invoice, by
// either the checklist item's expected type OR the AI's detected type. Bank
// statements, tax slips, trial balances and the like are NOT single
// transactions and are honestly skipped. Pure + no imports, so it is the single
// unit-tested source of truth; the server action just feeds it rows.

// The doc types that carry ONE bookkeeping transaction. Kept in step with
// TRANSACTION_DOC_TYPES in src/lib/ai/transaction-extract.ts (duplicated on
// purpose so the preview never pulls in the AI module).
export const SAGE_TRANSACTION_TYPES = new Set(["receipt", "invoice"]);

// An included document whose extraction confidence is below this is flagged so
// the accountant checks the numbers before trusting them.
export const SAGE_LOW_CONFIDENCE = 0.75;

export type SageDocInput = {
  id: string;
  name: string;
  // The checklist item's requested type, and the AI's detected type. Either
  // being a receipt/invoice makes the document a transaction document.
  expectedDocType: string | null;
  detectedType: string | null;
  // Whether a transaction extraction is already stored, and its confidence.
  hasTransaction: boolean;
  transactionConfidence: number | null;
};

export type SageSkipReason = "statement" | "not_transaction";

export type SagePreviewDoc =
  | { id: string; name: string; status: "included"; lowConfidence: boolean }
  | { id: string; name: string; status: "skipped"; reason: SageSkipReason };

export type SagePreview = {
  total: number;
  includedCount: number;
  skippedCount: number;
  lowConfidenceCount: number;
  // Skipped documents grouped by reason, for a compact summary line.
  skippedByReason: { reason: SageSkipReason; count: number }[];
  docs: SagePreviewDoc[];
};

// A document is exportable iff it is a receipt or sales invoice by either the
// expected (checklist) type or the detected (AI) type. Same rule the extraction
// gate uses, so the preview can never promise a row the exporter won't produce.
export function isSageExportable(
  expected: string | null,
  detected: string | null,
): boolean {
  return (
    SAGE_TRANSACTION_TYPES.has(expected ?? "") ||
    SAGE_TRANSACTION_TYPES.has(detected ?? "")
  );
}

// Why a non-transaction document is skipped. Statements are called out
// specifically (they're the classic "I exported and got almost nothing"
// surprise); everything else is simply "not a receipt or invoice".
function skipReason(detected: string | null): SageSkipReason {
  return detected === "bank_statement" ? "statement" : "not_transaction";
}

export function buildSagePreview(inputs: SageDocInput[]): SagePreview {
  const docs: SagePreviewDoc[] = inputs.map((d) => {
    if (isSageExportable(d.expectedDocType, d.detectedType)) {
      const lowConfidence =
        d.hasTransaction &&
        d.transactionConfidence != null &&
        d.transactionConfidence < SAGE_LOW_CONFIDENCE;
      return { id: d.id, name: d.name, status: "included", lowConfidence };
    }
    return {
      id: d.id,
      name: d.name,
      status: "skipped",
      reason: skipReason(d.detectedType),
    };
  });

  const includedCount = docs.filter((d) => d.status === "included").length;
  const skipped = docs.filter(
    (d): d is Extract<SagePreviewDoc, { status: "skipped" }> =>
      d.status === "skipped",
  );
  const lowConfidenceCount = docs.filter(
    (d) => d.status === "included" && d.lowConfidence,
  ).length;

  const byReason = new Map<SageSkipReason, number>();
  for (const s of skipped) {
    byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  }

  return {
    total: inputs.length,
    includedCount,
    skippedCount: skipped.length,
    lowConfidenceCount,
    skippedByReason: [...byReason.entries()].map(([reason, count]) => ({
      reason,
      count,
    })),
    docs,
  };
}
