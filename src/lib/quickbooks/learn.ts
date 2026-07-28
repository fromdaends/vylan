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

import { effectiveMapping } from "@/lib/quickbooks/draft-resolve";
import {
  learnKeyForName,
  taxLearnKey,
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

  // Tax code -> keyed by the document's canonical tax-token set (e.g. "GST+QST")
  // AND its DIRECTION. Without the direction in the key, a sale and a purchase
  // carrying the same taxes share one remembered rate, so approving an invoice
  // coded "GST/RST on Purchases" would then auto-fill that purchases rate on
  // every expense receipt for the client too — tax in the wrong box on the
  // return. Sales and purchases now remember separately.
  const taxKey = taxLearnKey(suggestion.taxSource ?? null, suggestion.direction);
  if (has(patch, "taxCode") && patch.taxCode && suggestion.taxSource && taxKey) {
    writes.push({
      signalType: "tax",
      sourceKey: taxKey,
      sourceSample: suggestion.taxSource,
      target: { id: patch.taxCode.id, name: patch.taxCode.name },
    });
  }

  // Split line accounts -> keyed by each line's description.
  //
  // NON-NULL IS NOT THE SAME AS CHOSEN. The split UI seeds its per-line state
  // from the EFFECTIVE accounts (draft-resolve.ts effectiveLines falls back to
  // the AI's own fuzzy match for any untouched line), and editing ONE line
  // posts the FULL map so the server's shallow replace keeps the others. So a
  // one-line correction arrives carrying the AI's guesses for every other line,
  // and learning those would harden a guess into a remembered "correction" —
  // exactly what this module's contract says it never does.
  //
  // A line therefore teaches only when its pick DIFFERS from what the AI
  // suggested for that same line. A deliberate re-pick of the AI's own
  // suggestion is skipped, which matches how the other signals behave (a
  // confirmation teaches nothing; only a correction does).
  if (has(patch, "lineAccounts") && patch.lineAccounts) {
    for (const [idx, ref] of Object.entries(patch.lineAccounts)) {
      if (!ref) continue;
      const line = suggestion.lines?.[Number(idx)];
      if (!line) continue;
      if (line.account.match && line.account.match.id === ref.id) continue;
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

// What an APPROVAL teaches.
//
// learnedWritesFromResolve only fires on a genuine CORRECTION — a field the
// accountant actively changed. That left the commonest case teaching nothing:
// the AI guesses right, the accountant approves, and the next document from the
// same supplier is guessed from scratch again. Hubdoc closes this with a "save
// configuration" tick on the first document from a supplier; approving IS our
// equivalent of that tick, so approval records the EFFECTIVE values — the
// accountant's own picks where they made them, the AI's match where they looked
// at it and let it stand.
//
// This is a deliberate widening of "we learn ONLY genuine picks": approving a
// draft is itself the genuine pick. The cost is that approving without reading
// carefully teaches whatever was on screen — an accepted trade, since that
// draft was about to be posted to the real books anyway.
//
// SPLIT LINES ARE DELIBERATELY EXCLUDED. A line the accountant actually chose
// is already learned by the resolve path, and the rest of the map is seeded
// from the AI's own guesses (see the note on the lineAccounts branch above) —
// they are not on screen the way the header fields are, so an approval is not
// evidence anyone looked at them.
export function learnedWritesFromApproval(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): LearnedWrite[] {
  const writes: LearnedWrite[] = [];
  const partySource = suggestion.partySource ?? null;
  const eff = effectiveMapping(suggestion, resolved);

  if (eff.party && suggestion.partyKind && partySource) {
    const key = learnKeyForName(partySource);
    if (key) {
      writes.push({
        signalType: suggestion.partyKind,
        sourceKey: key,
        sourceSample: partySource,
        target: { id: eff.party.id, name: eff.party.name },
      });
    }
  }

  // Same expenses-only gate as the resolve path: on an income draft the account
  // isn't the posting target (the item is), and an unknown direction is too
  // ambiguous to generalize from.
  if (eff.account && suggestion.direction === "expense" && partySource) {
    const key = learnKeyForName(partySource);
    if (key) {
      writes.push({
        signalType: "expense_account",
        sourceKey: key,
        sourceSample: partySource,
        target: { id: eff.account.id, name: eff.account.name },
      });
    }
  }

  const taxKey = taxLearnKey(suggestion.taxSource ?? null, suggestion.direction);
  if (eff.taxCode && suggestion.taxSource && taxKey) {
    writes.push({
      signalType: "tax",
      sourceKey: taxKey,
      sourceSample: suggestion.taxSource,
      target: { id: eff.taxCode.id, name: eff.taxCode.name },
    });
  }

  return writes;
}
