import { describe, it, expect } from "vitest";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import {
  selectNeedsAttention,
  selectNeedsAttentionRows,
  selectReadyToReview,
  selectActive,
  selectRecent,
  selectCompleted,
} from "./worklist-select";

function row(
  over: Partial<WorklistRow> & Pick<WorklistRow, "id">,
): WorklistRow {
  return {
    title: `Engagement ${over.id}`,
    clientName: "Client",
    status: "in_progress",
    dueDate: null,
    assigneeUserId: null,
    assigneeName: null,
    completionPct: 0.5,
    itemsDone: 1,
    itemsTotal: 2,
    attentionScore: 0,
    reasons: [],
    daysOverdue: null,
    daysUntilDue: null,
    daysSinceClientActivity: null,
    readyToReview: false,
    itemsReadyToReview: 0,
    recencyAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    ...over,
  };
}

describe("selectNeedsAttention", () => {
  it("keeps only flagged engagements, most urgent first", () => {
    const rows = [
      row({ id: "clean" }), // no reasons → excluded
      row({ id: "stale", reasons: ["stale"], attentionScore: 130 }),
      row({ id: "overdue", reasons: ["overdue"], attentionScore: 1003 }),
    ];

    const result = selectNeedsAttention(rows);

    expect(result.map((r) => r.id)).toEqual(["overdue", "stale"]);
    // The clean engagement never appears.
    expect(result.some((r) => r.id === "clean")).toBe(false);
  });

  it("returns nothing when no engagement is flagged", () => {
    expect(selectNeedsAttention([row({ id: "a" }), row({ id: "b" })])).toEqual(
      [],
    );
  });

  it("does not mutate the input array", () => {
    const rows = [
      row({ id: "a", reasons: ["stale"], attentionScore: 1 }),
      row({ id: "b", reasons: ["overdue"], attentionScore: 9 }),
    ];
    const before = rows.map((r) => r.id);
    selectNeedsAttention(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("selectNeedsAttentionRows (Overview block)", () => {
  it("includes any reason OR ready-to-review; excludes clean rows", () => {
    const rows = [
      row({ id: "clean" }),
      row({ id: "overdue", reasons: ["overdue"], attentionScore: 1003 }),
      row({ id: "ready", readyToReview: true, attentionScore: 0 }),
    ];
    const ids = selectNeedsAttentionRows(rows).map((r) => r.id);
    expect(ids).toContain("overdue");
    expect(ids).toContain("ready");
    expect(ids).not.toContain("clean");
  });

  it("orders by attentionScore (overdue > due_soon > stale), ready-to-review last", () => {
    const rows = [
      row({ id: "ready", readyToReview: true, attentionScore: 0 }),
      row({ id: "stale", reasons: ["stale"], attentionScore: 130 }),
      row({ id: "overdue", reasons: ["overdue"], attentionScore: 1003 }),
      row({ id: "due", reasons: ["due_soon"], attentionScore: 500 }),
    ];
    expect(selectNeedsAttentionRows(rows).map((r) => r.id)).toEqual([
      "overdue",
      "due",
      "stale",
      "ready",
    ]);
  });

  it("tie-breaks equal scores by recency, freshest first", () => {
    const rows = [
      row({
        id: "older",
        readyToReview: true,
        recencyAt: "2026-02-01T00:00:00.000Z",
      }),
      row({
        id: "newer",
        readyToReview: true,
        recencyAt: "2026-03-01T00:00:00.000Z",
      }),
    ];
    expect(selectNeedsAttentionRows(rows).map((r) => r.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("returns nothing when all rows are clean", () => {
    expect(
      selectNeedsAttentionRows([row({ id: "a" }), row({ id: "b" })]),
    ).toEqual([]);
  });
});

describe("selectReadyToReview", () => {
  it("keeps only ready engagements, freshest first", () => {
    const rows = [
      row({ id: "not-ready" }), // readyToReview false → excluded
      row({
        id: "older",
        readyToReview: true,
        recencyAt: "2026-02-01T00:00:00.000Z",
      }),
      row({
        id: "newer",
        readyToReview: true,
        recencyAt: "2026-03-01T00:00:00.000Z",
      }),
    ];

    const result = selectReadyToReview(rows);

    expect(result.map((r) => r.id)).toEqual(["newer", "older"]);
    expect(result.some((r) => r.id === "not-ready")).toBe(false);
  });

  it("returns nothing when nothing is ready", () => {
    expect(selectReadyToReview([row({ id: "a" }), row({ id: "b" })])).toEqual(
      [],
    );
  });
});

describe("selectActive / selectRecent / selectCompleted", () => {
  const rows = [
    row({ id: "draft", status: "draft" }),
    row({ id: "sent", status: "sent" }),
    row({ id: "live", status: "in_progress" }),
    row({ id: "done", status: "complete" }),
    row({ id: "killed", status: "cancelled" }),
  ];

  it("selectActive keeps draft/sent/in_progress, drops complete + cancelled", () => {
    expect(selectActive(rows).map((r) => r.id)).toEqual([
      "draft",
      "sent",
      "live",
    ]);
  });

  it("selectRecent keeps everything except complete (cancelled stays)", () => {
    expect(selectRecent(rows).map((r) => r.id)).toEqual([
      "draft",
      "sent",
      "live",
      "killed",
    ]);
  });

  it("selectCompleted keeps only complete", () => {
    expect(selectCompleted(rows).map((r) => r.id)).toEqual(["done"]);
  });
});
