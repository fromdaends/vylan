import { describe, it, expect } from "vitest";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import {
  selectView,
  scopeForView,
  readyToReviewCount,
  recentlyDeletedCount,
  ENGAGEMENT_VIEWS,
  TAB_VIEWS,
  MENU_VIEWS,
} from "./views";

function row(
  over: Partial<WorklistRow> & Pick<WorklistRow, "id">,
): WorklistRow {
  // Mirror the loader: derivedStatus re-reads a live ready row as
  // ready_to_review, otherwise echoes the stored status.
  const status = over.status ?? "in_progress";
  const derivedStatus =
    over.derivedStatus ??
    (over.readyToReview && (status === "sent" || status === "in_progress")
      ? "ready_to_review"
      : status);
  return {
    title: `Engagement ${over.id}`,
    clientName: "Client",
    clientId: "client-1",
    // Progress counts TASKS now (see worklist.ts).
    tasksDone: 1,
    tasksTotal: 2,
    status: "in_progress",
    derivedStatus,
    dueDate: null,
    assigneeUserId: null,
    assigneeName: null,
    approvedPct: 0.5,
    awaitingPct: 0,
    itemsDone: 1,
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

// Active-scope fixture (what loadEngagementWorklist("active") returns):
// no archived / deleted rows here.
const activeRows: WorklistRow[] = [
  row({ id: "draft", status: "draft" }),
  row({ id: "sent", status: "sent" }),
  row({ id: "live", status: "in_progress" }),
  row({ id: "ready", status: "in_progress", readyToReview: true }),
  row({ id: "done", status: "complete" }),
  row({ id: "killed", status: "cancelled" }),
];

describe("scopeForView", () => {
  it("maps archived / deleted to their own scopes, everything else to active", () => {
    expect(scopeForView("archived")).toBe("archived");
    expect(scopeForView("deleted")).toBe("deleted");
    for (const v of ["active", "ready", "drafts", "completed"] as const) {
      expect(scopeForView(v)).toBe("active");
    }
  });
});

describe("selectView (active scope)", () => {
  it("active = in-flight only (draft/sent/in_progress), no complete/cancelled", () => {
    expect(selectView("active", activeRows).map((r) => r.id)).toEqual([
      "draft",
      "sent",
      "live",
      "ready",
    ]);
  });
  it("ready = readyToReview only", () => {
    expect(selectView("ready", activeRows).map((r) => r.id)).toEqual(["ready"]);
  });
  it("drafts = draft only", () => {
    expect(selectView("drafts", activeRows).map((r) => r.id)).toEqual(["draft"]);
  });
  it("completed = complete only", () => {
    expect(selectView("completed", activeRows).map((r) => r.id)).toEqual([
      "done",
    ]);
  });
  // There is no Cancelled view any more (cancelling isn't reachable from the
  // UI, so the tab could only ever be empty). The 'killed' row must therefore
  // not leak into a view it doesn't belong to — it simply has no tab.
  it("a cancelled engagement appears in NO active-scope view", () => {
    for (const v of ["active", "ready", "drafts", "completed"] as const) {
      expect(selectView(v, activeRows).map((r) => r.id)).not.toContain("killed");
    }
  });
});

describe("selectView (archived / deleted scopes are status-agnostic)", () => {
  it("archived shows whatever the archived scope returned", () => {
    const archived = [
      row({ id: "a", status: "in_progress", archivedAt: "2026-02-01" }),
      row({ id: "b", status: "complete", archivedAt: "2026-02-02" }),
    ];
    expect(selectView("archived", archived).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });
  it("deleted shows whatever the deleted scope returned", () => {
    const deleted = [
      row({ id: "x", status: "sent", deletedAt: "2026-05-20" }),
      row({ id: "y", status: "cancelled", deletedAt: "2026-05-21" }),
    ];
    expect(selectView("deleted", deleted).map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("badge counts", () => {
  it("readyToReviewCount counts ready rows in the active set", () => {
    expect(readyToReviewCount(activeRows)).toBe(1);
  });
  it("recentlyDeletedCount is the size of the deleted set", () => {
    expect(recentlyDeletedCount([row({ id: "x" }), row({ id: "y" })])).toBe(2);
  });
});

describe("ENGAGEMENT_VIEWS", () => {
  it("lists every routed view in nav order", () => {
    expect(ENGAGEMENT_VIEWS).toEqual([
      "active",
      "all",
      "ready",
      "drafts",
      "completed",
      "archived",
      "deleted",
    ]);
  });

  // ⚠️ THE TABS AND THE ROUTES ARE DIFFERENT LISTS NOW. The founder cut the tab
  // strip to three: "The only top tab things should be: Active, Drafts, All
  // engagements." The other four kept their routes, so nothing 404s and no link
  // anywhere in the app breaks.
  it("shows exactly three tabs", () => {
    expect(TAB_VIEWS).toEqual(["active", "drafts", "all"]);
  });

  // ⚠️ THE ONE THAT MATTERS. Recently deleted is a 30-day recovery window with
  // a purge cron on the other side of it — unreachable in the UI means
  // unrecoverable in practice. Every routed view must be reachable from either
  // the tabs or the overflow menu, EXCEPT completed, which All engagements
  // contains.
  it("leaves no view stranded", () => {
    const reachable = new Set([...TAB_VIEWS, ...MENU_VIEWS]);
    const stranded = ENGAGEMENT_VIEWS.filter(
      (v) => !reachable.has(v) && v !== "completed",
    );
    expect(stranded).toEqual([]);
    expect(reachable.has("deleted")).toBe(true);
  });

  it("all = every status, archived and deleted excluded by its scope", () => {
    expect(scopeForView("all")).toBe("active");
    const rows = [
      row({ id: "a", status: "draft" }),
      row({ id: "b", status: "complete" }),
      row({ id: "c", status: "in_progress" }),
    ];
    expect(selectView("all", rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
