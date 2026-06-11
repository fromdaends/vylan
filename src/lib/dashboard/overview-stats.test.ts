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
    itemsDone: 0,
    itemsTotal: 2,
    itemsRequiredBlocked: 0,
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
  const waiting = row({ id: "w", status: "sent", itemsRequiredBlocked: 1 });

  it("true for a live engagement where the client owes a required doc and nothing awaits the accountant", () => {
    expect(isWaitingOnClient(waiting)).toBe(true);
    expect(
      isWaitingOnClient(row({ id: "w2", status: "in_progress", itemsRequiredBlocked: 3 })),
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

  it("false when the client owes nothing (all approved / parked / nothing requested)", () => {
    expect(isWaitingOnClient({ ...waiting, itemsRequiredBlocked: 0 })).toBe(
      false,
    );
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
      // Active + waiting on client.
      row({ id: "a", status: "sent", itemsRequiredBlocked: 1 }),
      // Active + ready to review.
      row({ id: "b", status: "in_progress", readyToReview: true }),
      // Active + due soon + waiting on client (counts in both).
      row({
        id: "c",
        status: "sent",
        itemsRequiredBlocked: 2,
        daysUntilDue: 5,
      }),
      // Draft: active, but never waiting/due.
      row({ id: "d", status: "draft", itemsRequiredBlocked: 1, daysUntilDue: 2 }),
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
