import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));
// The panel now carries the engagement's comment thread, which fetches its own
// rows on mount; unmocked it reaches cookies() outside a request scope.
vi.mock("@/app/actions/comments", () => ({
  loadCommentThreadAction: vi.fn(async () => ({
    comments: [],
    members: [],
    currentUserId: "u-me",
    legacy: false,
  })),
  loadCommentCountsAction: vi.fn(async () => ({})),
  addCommentAction: vi.fn(async () => ({ ok: false, error: "failed" })),
  deleteCommentAction: vi.fn(async () => ({ ok: true })),
}));

import { EngagementDetailPanel } from "./engagement-detail-panel";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

const ROW: WorklistRow = {
  id: "e-1",
  title: "T2 Tax Return",
  clientName: "ABC Incorporation Inc",
  clientId: "c-1",
  status: "in_progress",
  derivedStatus: "in_progress",
  flaggedFilesCount: 0,
  signedCopiesToConfirm: 0,
  waitingSince: null,
  waitingDays: null,
  sittingUnreviewed: false,
  dueDate: null,
  assigneeUserId: "u-tyler",
  assigneeName: "Tyler Jette",
  approvedPct: 0,
  awaitingPct: 0,
  tasksDone: 2,
  tasksTotal: 5,
  serviceNames: ["Monthly bookkeeping"],
  startedAt: "2026-07-07T00:00:00.000Z",
  itemsDone: 0,
  itemsTotal: 0,
  attentionScore: 0,
  reasons: [],
  daysOverdue: null,
  daysUntilDue: null,
  daysSinceClientActivity: 1,
  readyToReview: false,
  itemsReadyToReview: 0,
  recencyAt: "2026-07-07T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
};

function renderPanel(
  over: Partial<WorklistRow> = {},
  onReassign = vi.fn(),
  canEdit = true,
) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementDetailPanel
        row={{ ...ROW, ...over }}
        members={MEMBERS}
        canEdit={canEdit}
        locale="en"
        onClose={vi.fn()}
        onReassign={onReassign}
      />
    </NextIntlClientProvider>,
  );
  return onReassign;
}

afterEach(cleanup);

describe("EngagementDetailPanel", () => {
  it("answers who/when/what without leaving the list", () => {
    renderPanel();
    expect(screen.getByText("T2 Tax Return")).toBeTruthy();
    expect(screen.getByText("ABC Incorporation Inc")).toBeTruthy();
    expect(screen.getByText("Monthly bookkeeping")).toBeTruthy();
    // Work is a COUNT, never an adjective — the whole point of the agreement
    // /work split. "2 of 5 done" stays true when a sixth task starts.
    expect(screen.getByText("2 of 5 done")).toBeTruthy();
  });

  it("is never a dead end — it can always open the full engagement", () => {
    renderPanel();
    const open = screen.getByRole("link", { name: /Open engagement/i });
    expect(open.getAttribute("href")).toBe("/engagements/e-1");
  });

  it("assigns the engagement to somebody who is not on it", () => {
    const onReassign = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /Zachary Thresh/i }));
    expect(onReassign).toHaveBeenCalledWith("u-zach");
  });

  // ⚠️ THE ONE THAT MATTERS. A single-select built the obvious way is a
  // ONE-WAY DOOR: you can hand the job to somebody else, but there is no way
  // to take the last name off it, because every option assigns. Ticking the
  // person already on it must UNASSIGN. Watched failing against the real bug
  // (`onReassign(m.id)` unconditionally) before being trusted.
  it("takes the name off when you tick the person already assigned", () => {
    const onReassign = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /Tyler Jette/i }));
    expect(onReassign).toHaveBeenCalledWith(null);
  });

  it("shows a radio, not a checkbox — an engagement has ONE assignee", () => {
    renderPanel();
    // If this ever flips to checkboxes, the data model grew a real many-side
    // and engagements.assigned_user_id is no longer the whole story.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says so plainly when nobody is on it", () => {
    renderPanel({ assigneeUserId: null, assigneeName: null });
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  it("does not promise an edit a viewer without a roster cannot make", () => {
    renderPanel({}, vi.fn(), false);
    for (const r of screen.getAllByRole("radio")) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
