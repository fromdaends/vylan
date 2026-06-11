import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectActive } from "@/lib/dashboard/worklist-select";

// The Overview stats strip's four counts. Pure — fed the same WorklistRow[]
// the page already loads (one cached query, zero extra round-trips) and built
// ONLY from fields the unified status engine / action signals computed, so the
// strip can never disagree with the surfaces it links to:
//   * active        — same selectActive rule as the /engagements "Active" view.
//   * readyToReview — same readyToReview flag as the sidebar badge + Ready view.
//   * waitingOnClients — live engagements where NOTHING awaits the accountant
//     (no undecided submission at either the item or file level, no flagged
//     uploads, no signed copies to confirm) AND the client still owes at least
//     one required document. The "ball is entirely in the client's court" set.
//   * dueSoon — live engagements whose due date falls within the next 7 days.
//     A calendar fact, deliberately NOT the chase chip's rule (the chip also
//     requires <80% completion; the stat counts every approaching deadline).

export const DUE_SOON_WINDOW_DAYS = 7;

export type OverviewStats = {
  active: number;
  readyToReview: number;
  waitingOnClients: number;
  dueSoon: number;
};

// Live = the client can still act (sent / in_progress). Drafts are excluded
// from the waiting/due counts: an unsent engagement isn't waiting on anyone.
function isLive(r: WorklistRow): boolean {
  return r.status === "sent" || r.status === "in_progress";
}

export function isWaitingOnClient(r: WorklistRow): boolean {
  return (
    isLive(r) &&
    // Nothing awaits the accountant: no submitted/AI-bounced item…
    r.itemsReadyToReview === 0 &&
    // …no file-level undecided upload (catches e.g. a pending duplicate
    // sibling on an already-decided item)…
    r.waitingSince === null &&
    // …no flagged uploads, no returned signed copies.
    r.flaggedFilesCount === 0 &&
    r.signedCopiesToConfirm === 0 &&
    // And the client still owes at least one required document. This also
    // excludes the "all approved, awaiting Mark complete" parked state and
    // engagements that request nothing.
    r.itemsRequiredBlocked > 0
  );
}

export function isDueSoon(r: WorklistRow): boolean {
  // daysUntilDue is null when there's no due date OR the engagement is already
  // overdue (overdue is its own red signal in Needs attention, not "due soon").
  return (
    isLive(r) &&
    r.daysUntilDue !== null &&
    r.daysUntilDue <= DUE_SOON_WINDOW_DAYS
  );
}

export function computeOverviewStats(rows: WorklistRow[]): OverviewStats {
  return {
    active: selectActive(rows).length,
    readyToReview: rows.filter((r) => r.readyToReview).length,
    waitingOnClients: rows.filter(isWaitingOnClient).length,
    dueSoon: rows.filter(isDueSoon).length,
  };
}
