import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import type { ReactNode } from "react";
import {
  render,
  fireEvent,
  within,
  screen,
  cleanup,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EngagementsWorklist, type WorklistRow } from "./engagements-worklist";
import en from "../../../messages/en.json";

// Stub the locale-aware <Link> (needs next/navigation, absent under vitest)
// with a plain anchor; capture router.push so we can assert row-click nav.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push }),
}));

// The row menu imports server actions; stub them so the test doesn't pull in
// server-only modules (next/headers, supabase). They're only invoked on click.
vi.mock("@/app/actions/engagements", () => ({
  archiveEngagementAction: async () => {},
  unarchiveEngagementAction: async () => {},
  softDeleteEngagementAction: async () => {},
  restoreEngagementAction: async () => {},
}));

// Radix DropdownMenu (the row "..." menu) leans on a few DOM APIs happy-dom
// doesn't implement. Plain assignments survive vi.restoreAllMocks.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(() => {
  cleanup();
  push.mockClear();
  // The worklist persists its tab choice per user in localStorage; clear it so
  // a tab click in one test doesn't leak into the next test's default.
  localStorage.clear();
});

// A base row with sane defaults; each fixture overrides what it needs.
function row(over: Partial<WorklistRow> & Pick<WorklistRow, "id" | "title">): WorklistRow {
  // Mirror the loader: derivedStatus re-reads a live ready row as
  // ready_to_review, otherwise echoes the stored status.
  const status = over.status ?? "in_progress";
  const derivedStatus =
    over.derivedStatus ??
    (over.readyToReview && (status === "sent" || status === "in_progress")
      ? "ready_to_review"
      : status);
  return {
    clientName: "Client",
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

// A = overdue + mine, B = stale + someone else's, C = clean + mine + newest,
// D = clean + unassigned + draft + oldest, E = cancelled + mine.
const rows: WorklistRow[] = [
  row({
    id: "a",
    title: "Smith T1",
    clientName: "Smith",
    assigneeUserId: "me",
    assigneeName: "Alex",
    status: "in_progress",
    reasons: ["overdue"],
    daysOverdue: 3,
    attentionScore: 1003,
    recencyAt: "2026-03-02T00:00:00.000Z",
  }),
  row({
    id: "b",
    title: "Jones Bookkeeping",
    clientName: "Jones",
    assigneeUserId: "other",
    assigneeName: "Blair",
    status: "sent",
    reasons: ["stale"],
    daysSinceClientActivity: 6,
    attentionScore: 130,
    recencyAt: "2026-02-01T00:00:00.000Z",
  }),
  row({
    id: "c",
    title: "Tremblay T2",
    clientName: "Tremblay",
    assigneeUserId: "me",
    assigneeName: "Alex",
    status: "complete",
    recencyAt: "2026-03-20T00:00:00.000Z",
  }),
  row({
    id: "d",
    title: "Gagnon Custom",
    clientName: "Gagnon",
    assigneeUserId: null,
    assigneeName: null,
    status: "draft",
    recencyAt: "2026-01-05T00:00:00.000Z",
  }),
  row({
    id: "e",
    title: "Roy Year-End",
    clientName: "Roy",
    assigneeUserId: "me",
    assigneeName: "Alex",
    status: "cancelled",
    recencyAt: "2026-02-15T00:00:00.000Z",
  }),
];

// Scope every query to *this* render's container. RTL's bound queries (and
// the global `screen`) default to document.body, so a worklist left mounted
// by an earlier test — with a stale search term or filter — would otherwise
// bleed into the next test's assertions.
// Defaults to an OWNER render (default tab = Recent) so the table-behaviour
// tests see every row; pass isOwner=false to exercise the staff default (Mine).
function renderWorklist(
  items: WorklistRow[] = rows,
  currentUserId = "me",
  isOwner = true,
  teamEnabled = true,
) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementsWorklist
        rows={items}
        currentUserId={currentUserId}
        isOwner={isOwner}
        teamEnabled={teamEnabled}
        locale="en"
      />
    </NextIntlClientProvider>,
  );
  return within(container);
}

describe("EngagementsWorklist", () => {
  it("defaults to Recent: active + cancelled work, newest first; complete excluded", () => {
    const q = renderWorklist();

    expect(
      q.getByRole("tab", { name: en.Dashboard.wl_filter_recent }),
    ).toHaveAttribute("aria-selected", "true");

    // Recent shows in-flight work, newest first: A (Mar 02) > B (Feb 01) >
    // D (Jan 05). C (Tremblay) is complete, so it's excluded.
    const a = q.getByRole("link", { name: /Smith T1/i });
    const b = q.getByRole("link", { name: /Jones Bookkeeping/i });
    const d = q.getByRole("link", { name: /Gagnon Custom/i });
    expect(a.compareDocumentPosition(b)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(b.compareDocumentPosition(d)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      q.queryByRole("link", { name: /Tremblay T2/i }),
    ).not.toBeInTheDocument();
    // A cancelled engagement (E) stays visible in Recent — it must not vanish
    // on cancel; only successfully-completed work drops out.
    expect(q.getByRole("link", { name: /Roy Year-End/i })).toBeInTheDocument();
  });

  it("a staff member (non-owner) defaults to the Mine tab", () => {
    const q = renderWorklist(rows, "me", false);
    expect(
      q.getByRole("tab", { name: en.Dashboard.wl_filter_mine }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("hides Mine and assignment details when team mode is off", () => {
    const q = renderWorklist(rows, "me", true, false);

    expect(
      q.queryByRole("tab", { name: en.Dashboard.wl_filter_mine }),
    ).not.toBeInTheDocument();
    expect(q.queryByText(en.Dashboard.wl_col_assigned)).not.toBeInTheDocument();
    expect(q.queryByText("Alex")).not.toBeInTheDocument();
    expect(q.queryByText("Blair")).not.toBeInTheDocument();
  });

  it("has no All tab — a Browse all link points to the full list instead", () => {
    const q = renderWorklist();
    expect(
      q.queryByRole("tab", { name: en.Dashboard.wl_filter_all }),
    ).not.toBeInTheDocument();
    expect(
      q.getByRole("link", { name: en.Dashboard.wl_view_all }),
    ).toHaveAttribute("href", "/engagements");
  });

  it("limits Mine to my active + cancelled engagements", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("tab", { name: en.Dashboard.wl_filter_mine }));

    // A (Smith) is in-progress and assigned to me; E (Roy) is cancelled but
    // still mine, so it stays visible too.
    expect(q.getByRole("link", { name: /Smith T1/i })).toBeInTheDocument();
    expect(q.getByRole("link", { name: /Roy Year-End/i })).toBeInTheDocument();
    // C (Tremblay) is mine but complete → excluded; B is someone else's;
    // D is unassigned.
    expect(
      q.queryByRole("link", { name: /Tremblay T2/i }),
    ).not.toBeInTheDocument();
    expect(
      q.queryByRole("link", { name: /Jones Bookkeeping/i }),
    ).not.toBeInTheDocument();
    expect(
      q.queryByRole("link", { name: /Gagnon Custom/i }),
    ).not.toBeInTheDocument();
  });

  it("Complete tab shows only completed engagements", () => {
    const q = renderWorklist();
    fireEvent.click(
      q.getByRole("tab", { name: en.Dashboard.wl_filter_complete }),
    );

    // Only C (Tremblay) is complete; the active ones are hidden.
    expect(q.getByRole("link", { name: /Tremblay T2/i })).toBeInTheDocument();
    expect(
      q.queryByRole("link", { name: /Smith T1/i }),
    ).not.toBeInTheDocument();
    expect(
      q.queryByRole("link", { name: /Gagnon Custom/i }),
    ).not.toBeInTheDocument();
  });

  it("searches by engagement title or client name across the full set", () => {
    const q = renderWorklist();
    // 'gagnon' is a clean/draft row hidden under the default pill, but
    // search spans every engagement, not just the active filter.
    fireEvent.change(q.getByRole("searchbox"), { target: { value: "gagnon" } });

    expect(q.getByRole("link", { name: /Gagnon Custom/i })).toBeInTheDocument();
    expect(q.queryByRole("link", { name: /Smith T1/i })).not.toBeInTheDocument();
  });

  it("shows the search empty state when nothing matches", () => {
    const q = renderWorklist();
    fireEvent.change(q.getByRole("searchbox"), { target: { value: "zzzzz" } });

    expect(q.getByText(en.Dashboard.wl_empty_search)).toBeInTheDocument();
    // No engagement-row links remain (the header "Browse all" link stays).
    expect(
      q.queryByRole("link", { name: /Smith T1/i }),
    ).not.toBeInTheDocument();
  });

  it("labels unassigned engagements", () => {
    const q = renderWorklist();
    // Recent (default) shows every engagement, so Gagnon's unassigned row
    // is present without switching tabs.
    const gagnon = q
      .getByRole("link", { name: /Gagnon Custom/i })
      .closest("tr") as HTMLElement;
    expect(within(gagnon).getByText(en.Dashboard.wl_unassigned)).toBeInTheDocument();
  });

  it("optimistically removes a row the moment Archive is clicked", async () => {
    const q = renderWorklist();
    // Smith T1 is visible in the default Recent view.
    const smithRow = q
      .getByRole("link", { name: /Smith T1/i })
      .closest("tr") as HTMLElement;
    // Open its "..." actions menu (Radix opens on pointer-down).
    const trigger = within(smithRow).getByRole("button", {
      name: en.Engagements.menu_actions,
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    // The menu content is portaled to the body, so query globally.
    const archiveItem = await screen.findByRole("menuitem", {
      name: en.Engagements.menu_archive,
    });
    fireEvent.click(archiveItem);
    // The row is gone immediately — before any server revalidation. The mocked
    // action resolves with no fresh `rows`, so only the optimistic overlay can
    // remove it.
    expect(
      q.queryByRole("link", { name: /Smith T1/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking anywhere on a row opens that engagement", () => {
    const q = renderWorklist();
    const smithRow = q
      .getByRole("link", { name: /Smith T1/i })
      .closest("tr") as HTMLElement;
    // Click the row itself, not the title link or the "..." menu button.
    fireEvent.click(smithRow);
    expect(push).toHaveBeenCalledWith("/engagements/a");
  });

  it("clicking the engagement title navigates via the link, not a second router push", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("link", { name: /Smith T1/i }));
    // The title is a real <a> (the row's onClick bows out for links/buttons),
    // so the router isn't called a second time.
    expect(push).not.toHaveBeenCalled();
  });
});

// The Status column's whole job changed: a live engagement now reads its
// workflow STAGE instead of the generic "In progress" every live row shared.
describe("status column — workflow stage", () => {
  const stageRow = (over: Partial<WorklistRow> = {}) =>
    row({ id: "s1", title: "Stage Row", ...over });

  function statusCellOf(q: ReturnType<typeof renderWorklist>) {
    const tr = q.getByRole("link", { name: /Stage Row/i }).closest("tr")!;
    // Status is the last cell before the actions column.
    const cells = within(tr as HTMLElement).getAllByRole("cell");
    return cells[cells.length - 2];
  }

  it("shows the stage chip instead of the In progress pill", () => {
    const q = renderWorklist([stageRow({ stage: "in_preparation" })]);
    const cell = statusCellOf(q);
    expect(cell).toHaveTextContent(en.Stage.stage_in_preparation);
    expect(cell).not.toHaveTextContent(en.Status.in_progress);
  });

  it("the stage supersedes the green Ready to review pill too", () => {
    // Both would otherwise apply to this row. If the ready pill won, the stage
    // system would be invisible on nearly every row whose stage is in_review —
    // so the stage has to take the column outright.
    const q = renderWorklist([
      stageRow({ stage: "in_review", readyToReview: true }),
    ]);
    const cell = statusCellOf(q);
    expect(cell).toHaveTextContent(en.Stage.stage_in_review);
    expect(cell).not.toHaveTextContent(en.Status.ready_to_review);
  });

  it("falls back to the status pill when there is no stage (draft)", () => {
    const q = renderWorklist([
      stageRow({ status: "draft", derivedStatus: "draft", stage: null }),
    ]);
    expect(statusCellOf(q)).toHaveTextContent(en.Status.draft);
  });

  it("falls back to the status pill when the stage column is absent (pre-migration)", () => {
    // stage undefined = migration 0690 not applied in this environment. The
    // table must read exactly as it did before the feature existed.
    const q = renderWorklist([stageRow({})]);
    expect(statusCellOf(q)).toHaveTextContent(en.Status.in_progress);
  });

  it("renders each stage with its own label", () => {
    const stages = [
      ["collecting", en.Stage.stage_collecting],
      ["in_review", en.Stage.stage_in_review],
      ["in_preparation", en.Stage.stage_in_preparation],
      ["awaiting_signature", en.Stage.stage_awaiting_signature],
      ["awaiting_payment", en.Stage.stage_awaiting_payment],
      ["completed", en.Stage.stage_completed],
    ] as const;
    for (const [stage, label] of stages) {
      const q = renderWorklist([
        stageRow({ stage, status: "in_progress", derivedStatus: "in_progress" }),
      ]);
      expect(statusCellOf(q)).toHaveTextContent(label);
      cleanup();
    }
  });

  // Radix opens its menu on pointer-down, not click (matches the archive test).
  function openRowMenu(q: ReturnType<typeof renderWorklist>) {
    const tr = q.getByRole("link", { name: /Stage Row/i }).closest("tr")!;
    fireEvent.pointerDown(
      within(tr as HTMLElement).getByRole("button", {
        name: en.Engagements.menu_actions,
      }),
      { button: 0, ctrlKey: false },
    );
  }

  it("offers the stage picker in the row menu", async () => {
    const q = renderWorklist([stageRow({ stage: "in_review" })]);
    openRowMenu(q);
    // Portaled to the body, so query globally.
    expect(
      await screen.findByRole("menuitem", { name: en.Stage.change }),
    ).toBeInTheDocument();
  });

  it("shows no stage picker on a row with no stage", async () => {
    const q = renderWorklist([stageRow({ stage: null })]);
    openRowMenu(q);
    // Archive proves the menu opened; the stage item is simply absent.
    await screen.findByRole("menuitem", { name: en.Engagements.menu_archive });
    expect(
      screen.queryByRole("menuitem", { name: en.Stage.change }),
    ).not.toBeInTheDocument();
  });
});
