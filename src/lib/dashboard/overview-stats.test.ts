import { describe, it, expect } from "vitest";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import {
  computeOverviewStats,
  isWaitingOnClient,
  isDueSoon,
} from "./overview-stats";

function row(over: Partial<WorklistRow> & Pick<WorklistRow, "id">): WorklistRow {
  const status = over.status ?? "in_progress";
  const derivedStatus =
    over.derivedStatus ??
    (over.readyToReview && (status === "sent" || status === "in_progress")
      ? "ready_to_review"
      : status);
  return {
    title: `Engagement ${over.id}`,
    clientName: "Client",
    status: "in_progress",
    derivedStatus,
    dueDate: null,
    assigneeUserId: null,
    assigneeName: null,
    approvedPct: 0,
    awaitingPct: 0,
    // Default: the client owes both items (itemsTotal/itemsDone use the
    // engine's denominator — required items, or ALL items on an optional-only
    // checklist, so the same numbers cover both shapes).
    itemsDone: 0,
    itemsTotal: 2,
    attentionScore: 0,
    reasons: [],
    daysOverdue: null,
    daysUntilDue: null,
    daysSinceClientActivity: null,
    readyToReview: false,
    itemsReadyToReview: 0,
    flaggedFilesCount: 0,
    signedCopiesToConfirm: 0,
    waitingSince: null,
    waitingDays: null,
    sittingUnreviewed: false,
    recencyAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    ...over,
  };
}

// "Live AND the client still owes at least one document" — the intuitive
// "how many clients still owe me files" predicate.
describe("isWaitingOnClient", () => {
  const owing = row({ id: "w", status: "sent" }); // owes both items by default

  it("true for a live engagement where the client still owes a document", () => {
    expect(isWaitingOnClient(owing)).toBe(true);
    expect(
      isWaitingOnClient(
        row({ id: "w2", status: "in_progress", itemsDone: 1, itemsTotal: 3 }),
      ),
    ).toBe(true);
  });

  it("true for an optional-only checklist the client hasn't acted on (engine denominator fallback)", () => {
    // Custom checklists default every item to optional. The engine's
    // itemsTotal/itemsDone fall back to ALL items when none are required, so
    // an untouched all-optional engagement still counts as waiting.
    expect(
      isWaitingOnClient(
        row({ id: "opt", status: "sent", itemsDone: 0, itemsTotal: 4 }),
      ),
    ).toBe(true);
  });

  it("STILL true when the client owes docs even while the accountant also has work to do", () => {
    // The founder is waiting on the client for the OTHER documents regardless
    // of parallel accountant tasks (a submission to review, flagged/
    // auto-rejected files, a signed copy to confirm). An auto-rejected file is
    // itself the client's turn to re-upload, so none of these zero it out.
    // Regression: the old rule read 0 here even when the client clearly owed
    // documents.
    expect(isWaitingOnClient({ ...owing, itemsReadyToReview: 1 })).toBe(true);
    expect(isWaitingOnClient({ ...owing, flaggedFilesCount: 2 })).toBe(true);
    expect(
      isWaitingOnClient({ ...owing, waitingSince: "2026-06-01T00:00:00Z" }),
    ).toBe(true);
    expect(isWaitingOnClient({ ...owing, signedCopiesToConfirm: 1 })).toBe(
      true,
    );
  });

  it("false when the client owes nothing (everything submitted/approved/na)", () => {
    expect(
      isWaitingOnClient({ ...owing, itemsDone: 2, itemsTotal: 2 }),
    ).toBe(false);
  });

  it("false when the engagement requests no documents at all", () => {
    expect(
      isWaitingOnClient({ ...owing, itemsDone: 0, itemsTotal: 0 }),
    ).toBe(false);
  });

  it("false for drafts and terminal statuses (not live)", () => {
    for (const status of ["draft", "complete", "cancelled"] as const) {
      expect(isWaitingOnClient({ ...owing, status })).toBe(false);
    }
  });
});

describe("isDueSoon", () => {
  it("true when due within the 7-day window (today counts)", () => {
    expect(isDueSoon(row({ id: "d", status: "sent", daysUntilDue: 1 }))).toBe(
      true,
    );
    expect(isDueSoon(row({ id: "d", status: "sent", daysUntilDue: 7 }))).toBe(
      true,
    );
  });

  it("false past the window, with no due date, or already overdue (daysUntilDue null)", () => {
    expect(isDueSoon(row({ id: "d", status: "sent", daysUntilDue: 8 }))).toBe(
      false,
    );
    expect(isDueSoon(row({ id: "d", status: "sent" }))).toBe(false);
  });

  it("ignores completion: a nearly-done engagement with a close due date still counts", () => {
    // The Needs-attention chase chip requires <80% completion; the stat is a
    // plain calendar fact and must not inherit that gate.
    expect(
      isDueSoon(
        row({ id: "d", status: "sent", daysUntilDue: 3, approvedPct: 0.9 }),
      ),
    ).toBe(true);
  });

  it("false for drafts and terminal statuses", () => {
    for (const status of ["draft", "complete", "cancelled"] as const) {
      expect(isDueSoon(row({ id: "d", status, daysUntilDue: 2 }))).toBe(false);
    }
  });
});

describe("computeOverviewStats", () => {
  it("counts each stat independently from the same rows", () => {
    const rows: WorklistRow[] = [
      // Active + waiting on client (owes both items, per factory default).
      row({ id: "a", status: "sent" }),
      // Active + ready to review (nothing owed; a submission awaits).
      row({
        id: "b",
        status: "in_progress",
        readyToReview: true,
        itemsReadyToReview: 1,
        itemsDone: 2,
        itemsTotal: 2,
      }),
      // Active + due soon + waiting on client (counts in both).
      row({ id: "c", status: "sent", daysUntilDue: 5 }),
      // Draft: active, but never waiting/due.
      row({ id: "d", status: "draft", daysUntilDue: 2 }),
      // Complete: counts nowhere.
      row({ id: "e", status: "complete", derivedStatus: "complete" }),
      // Cancelled: counts nowhere.
      row({ id: "f", status: "cancelled", derivedStatus: "cancelled" }),
    ];
    expect(computeOverviewStats(rows)).toEqual({
      active: 4, // a, b, c, d — same rule as the /engagements Active view
      readyToReview: 1, // b
      waitingOnClients: 2, // a, c
      dueSoon: 1, // c
    });
  });

  it("returns explicit zeros on an empty board", () => {
    expect(computeOverviewStats([])).toEqual({
      active: 0,
      readyToReview: 0,
      waitingOnClients: 0,
      dueSoon: 0,
    });
  });
});
