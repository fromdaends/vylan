import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectActive } from "@/lib/dashboard/worklist-select";

// The Overview stats strip's four counts. Pure — fed the same WorklistRow[]
// the page already loads (one cached query, zero extra round-trips) and built
// ONLY from fields the unified status engine / action signals computed, so the
// strip can never disagree with the surfaces it links to:
//   * active        — same selectActive rule as the /engagements "Active" view.
//   * readyToReview — same readyToReview flag as the sidebar badge + Ready view.
//   * waitingOnClients — live engagements where the client still owes at least
//     one document. itemsDone counts submitted/approved/na (the client's part
//     is provided or excused), so itemsTotal − itemsDone is exactly the
//     pending+rejected set the client must still send OR re-send (an
//     AI-auto-rejected file is the client's turn to re-upload, not the
//     accountant's — the old rule wrongly treated it as accountant work and
//     read 0). Deliberately does NOT also require "nothing awaits the
//     accountant": an engagement can have a file for you to review AND still
//     owe other documents, and it's still one you're waiting on the client for.
//     itemsTotal/itemsDone use the engine's denominator — required items, or
//     ALL items on optional-only checklists.
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
  // Live AND the client still owes at least one document. itemsDone counts
  // submitted/approved/na, so itemsTotal − itemsDone is the pending+rejected
  // set the client must still provide (or re-provide — an auto-rejected file
  // that bounced back to them is their turn, not yours). This also correctly
  // excludes the "everything submitted, awaiting Mark complete" parked state
  // (done === total) and engagements that request nothing (total === 0).
  return isLive(r) && r.itemsTotal - r.itemsDone > 0;
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
