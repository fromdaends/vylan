// QuickBooks Feature 3 — derive what to LEARN from an accountant's resolve pick.
//
// PURE + side-effect-free (like suggest.ts / draft-resolve.ts). Given the partial
// `resolved` patch the accountant just saved and the draft's stored suggestion
// (which carries the raw source signals partySource / taxSource / line
// descriptions), it returns the learned-mapping writes to record. The resolve
// route persists them best-effort. Nothing here reads or writes a DB.
//
// We learn ONLY genuine picks: a field is learned when it's present in the patch
// AND set to a concrete {id,name} (a cleared field — null — teaches nothing). The
// KEY is recomputed with the SAME learnKeyForName / taxSource the matcher uses, so
// a write and a later lookup line up by construction.

import {
  learnKeyForName,
  type LearnSignal,
  type ResolvedEntry,
  type TransactionSuggestion,
} from "@/lib/quickbooks/suggest";

export type LearnedWrite = {
  signalType: LearnSignal;
  sourceKey: string;
  sourceSample: string;
  target: { id: string; name: string };
};

function has(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function learnedWritesFromResolve(
  patch: Partial<ResolvedEntry>,
  suggestion: TransactionSuggestion,
): LearnedWrite[] {
  const writes: LearnedWrite[] = [];
  const partySource = suggestion.partySource ?? null;

  // Vendor / customer name -> the chosen QuickBooks vendor / customer.
  if (has(patch, "party") && patch.party && suggestion.partyKind && partySource) {
    const key = learnKeyForName(partySource);
    if (key) {
      writes.push({
        signalType: suggestion.partyKind,
        sourceKey: key,
        sourceSample: partySource,
        target: { id: patch.party.id, name: patch.party.name },
      });
    }
  }

  // Single-line EXPENSE account -> keyed by the vendor name. Expenses only: an
  // income draft's account isn't the posting target (the item is), and an
  // unknown-direction draft is too ambiguous to generalize an expense account.
  if (
    has(patch, "account") &&
    patch.account &&
    suggestion.direction === "expense" &&
    partySource
  ) {
    const key = learnKeyForName(partySource);
    if (key) {
      writes.push({
        signalType: "expense_account",
        sourceKey: key,
        sourceSample: partySource,
        target: { id: patch.account.id, name: patch.account.name },
      });
    }
  }

  // Tax code -> keyed by the document's canonical tax-token set (e.g. "GST+QST").
  if (has(patch, "taxCode") && patch.taxCode && suggestion.taxSource) {
    writes.push({
      signalType: "tax",
      sourceKey: suggestion.taxSource,
      sourceSample: suggestion.taxSource,
      target: { id: patch.taxCode.id, name: patch.taxCode.name },
    });
  }

  // Split line accounts -> keyed by each line's description. The client sends the
  // FULL lineAccounts map; only the concrete (non-null) picks teach anything.
  if (has(patch, "lineAccounts") && patch.lineAccounts) {
    for (const [idx, ref] of Object.entries(patch.lineAccounts)) {
      if (!ref) continue;
      const line = suggestion.lines?.[Number(idx)];
      if (!line) continue;
      const key = learnKeyForName(line.description);
      if (key) {
        writes.push({
          signalType: "line_account",
          sourceKey: key,
          sourceSample: line.description,
          target: { id: ref.id, name: ref.name },
        });
      }
    }
  }

  return writes;
}
