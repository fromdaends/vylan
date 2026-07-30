// Which accounting system a RETRACTION should target — undo, or attaching a
// receipt to an already-posted transaction.
//
// The rule: a retraction follows the transaction, not the client. Once something
// is written to QuickBooks or Xero it lives there permanently, whatever the client
// connects afterwards, so the API that created it is the only one that can void,
// delete or attach to it.
//
// Before 1040 both retraction routes asked "is this client Xero-connected RIGHT
// NOW?" instead. A client posted under QuickBooks who later connected Xero sent
// every Undo to Xero carrying a numeric QuickBooks id (and the reverse sent a Xero
// UUID to QuickBooks). The id shapes cannot collide, so nothing was deleted by
// mistake — but the call failed, the draft stayed 'posted', and the entry stayed in
// the client's books with no way back from inside Vylan.
//
// This lives in its own module, and is pure, so both routes make the SAME decision
// and it can be tested without a database. Do NOT reuse
// resolveBookkeepingProvider here: that answers a different question (which
// pipeline a NEW draft belongs to), and current-connection is the right answer
// there precisely because nothing has been written yet.

import { isClientXeroConnected } from "@/lib/db/xero";
import type { DraftProvider } from "@/lib/db/quickbooks-suggestions";

export type RetractionTarget = DraftProvider;

// The decision itself, kept pure and separately testable.
export function providerForRetraction(input: {
  // What the post recorded (1040). Authoritative whenever present.
  postedProvider: DraftProvider | null;
  // The live connection check, used ONLY as the pre-1040 fallback.
  isXeroConnectedNow: boolean;
}): RetractionTarget {
  // Recorded at post time — believe it over anything the client has done since.
  if (input.postedProvider) return input.postedProvider;
  // NULL: posted before 1040 (or an unrecognised posted_realm_id shape the
  // backfill declined to guess at). Fall back to the old behaviour rather than
  // inventing an answer — it is wrong only in the same cases it was already wrong,
  // and these rows drain away as drafts are re-posted.
  return input.isXeroConnectedNow ? "xero" : "quickbooks";
}

// What the routes call. One entry point so undo and receipt-attach cannot drift
// apart, and the connection read only happens on the pre-1040 fallback path
// (a recorded provider needs no query at all).
export async function resolveRetractionProvider(draft: {
  postedProvider: DraftProvider | null;
  firmId: string;
  clientId: string;
}): Promise<RetractionTarget> {
  if (draft.postedProvider) {
    return providerForRetraction({
      postedProvider: draft.postedProvider,
      isXeroConnectedNow: false, // not consulted
    });
  }
  return providerForRetraction({
    postedProvider: null,
    isXeroConnectedNow: await isClientXeroConnected(
      draft.firmId,
      draft.clientId,
    ),
  });
}
