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

// The pure "ball is entirely in the client's court" predicate.
describe("isWaitingOnClient", () => {
  const waiting = row({ id: "w", status: "sent" });

  it("true for a live engagement where the client owes a doc and nothing awaits the accountant", () => {
    expect(isWaitingOnClient(waiting)).toBe(true);
    expect(
      isWaitingOnClient(
        row({ id: "w2", status: "in_progress", itemsDone: 1, itemsTotal: 3 }),
      ),
    ).toBe(true);
  });

  it("true for an optional-only checklist the client hasn't acted on (engine denominator fallback)", () => {
    // Custom checklists default every item to optional. The engine's
    // itemsTotal/itemsDone fall back to ALL items when none are required, so
    // an untouched all-optional engagement still counts as waiting — the same
    // engagement Needs attention chases via due_soon/stale. Regression test
    // for the review finding that a required-items-only rule read 0 here.
    expect(
      isWaitingOnClient(
        row({ id: "opt", status: "sent", itemsDone: 0, itemsTotal: 4 }),
      ),
    ).toBe(true);
  });

  it("false when an item-level submission (or AI bounce) awaits a decision", () => {
    expect(
      isWaitingOnClient({ ...waiting, itemsReadyToReview: 1 }),
    ).toBe(false);
  });

  it("false when a file-level upload sits undecided (e.g. a pending duplicate sibling)", () => {
    expect(
      isWaitingOnClient({ ...waiting, waitingSince: "2026-06-01T00:00:00Z" }),
    ).toBe(false);
  });

  it("false when flagged files await the accountant's call", () => {
    expect(isWaitingOnClient({ ...waiting, flaggedFilesCount: 2 })).toBe(false);
  });

  it("false when a returned signed copy awaits confirmation", () => {
    expect(isWaitingOnClient({ ...waiting, signedCopiesToConfirm: 1 })).toBe(
      false,
    );
  });

  it("false when the client owes nothing (everything done / parked awaiting Mark complete)", () => {
    expect(
      isWaitingOnClient({ ...waiting, itemsDone: 2, itemsTotal: 2 }),
    ).toBe(false);
  });

  it("false when the engagement requests no documents at all", () => {
    expect(
      isWaitingOnClient({ ...waiting, itemsDone: 0, itemsTotal: 0 }),
    ).toBe(false);
  });

  it("false for drafts and terminal statuses (not live)", () => {
    for (const status of ["draft", "complete", "cancelled"] as const) {
      expect(isWaitingOnClient({ ...waiting, status })).toBe(false);
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
