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
import {
  EngagementsWorklist,
  WorklistTable,
  type WorklistRow,
} from "./engagements-worklist";
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
    clientId: "client-1",
    // Progress counts TASKS now. A fixture with one done of two keeps the
    // existing bar assertions meaningful instead of every row reading empty.
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
describe("status column — the AGREEMENT, not the workflow", () => {
  // Replaces the workflow-stage pill. The founder's diagnosis: "an engagement
  // might have six tasks going on simultaneously, and it's hard to put a
  // specific word on what's going on."
  //
  // The stage cascade answered "how far along is this?", which has no honest
  // answer once an engagement holds parallel work — one signature task made the
  // WHOLE row read "Awaiting signature" while four others were mid-preparation.
  // These words describe the DEAL, which stays true however much is in flight.
  const agrRow = (over: Partial<WorklistRow> = {}) =>
    row({ id: "s1", title: "Stage Row", ...over });

  function statusCellOf(q: ReturnType<typeof renderWorklist>) {
    const tr = q.getByRole("link", { name: /Stage Row/i }).closest("tr")!;
    // By its own marker, not by counting from the end — Status has moved twice
    // and a positional lookup broke silently both times.
    return tr.querySelector('[data-column="status"]') as HTMLElement;
  }

  it("reads Draft before it has been sent", () => {
    const q = renderWorklist([
      agrRow({ status: "draft", derivedStatus: "draft" }),
    ]);
    expect(statusCellOf(q)).toHaveTextContent(en.Engagements.agr_draft);
  });

  it("reads Sent once the client has it and has done nothing", () => {
    const q = renderWorklist([
      agrRow({
        status: "sent",
        derivedStatus: "sent",
        startedAt: "2026-08-01T00:00:00Z",
        daysSinceClientActivity: null,
      }),
    ]);
    expect(statusCellOf(q)).toHaveTextContent(en.Engagements.agr_sent);
  });

  it("reads Active the moment the client has done anything", () => {
    const q = renderWorklist([
      agrRow({
        status: "sent",
        derivedStatus: "sent",
        startedAt: "2026-08-01T00:00:00Z",
        daysSinceClientActivity: 3,
      }),
    ]);
    expect(statusCellOf(q)).toHaveTextContent(en.Engagements.agr_active);
  });

  // No "complete" case here on purpose: this list filters completed engagements
  // out, so the row never renders and the assertion would be testing the filter
  // rather than the chip. resolveAgreementStatus covers it directly.

  it("NEVER shows a workflow stage, whatever the row carries", () => {
    // The point of the change. A row still carrying stage=awaiting_signature
    // must not surface it here: that is one task's business, not the deal's.
    const q = renderWorklist([
      agrRow({
        status: "in_progress",
        derivedStatus: "in_progress",
        stage: "awaiting_signature",
        startedAt: "2026-08-01T00:00:00Z",
      }),
    ]);
    const cell = statusCellOf(q);
    expect(cell).not.toHaveTextContent(en.Stage.stage_awaiting_signature);
    expect(cell).toHaveTextContent(en.Engagements.agr_active);
  });

  it("has no empty state — every row resolves to a word", () => {
    // The old chip only rendered when a stage had resolved and fell back to a
    // raw status pill otherwise, so the column could disagree with itself row
    // to row. The agreement status is derivable for every row.
    const q = renderWorklist([agrRow({})]);
    expect(statusCellOf(q).textContent?.trim()).not.toBe("");
  });
});

// ⚠️ SORTING USED TO EXIST ON EXACTLY ONE OF THE FIVE LISTS BUILT FROM THIS
// TABLE. The Status header was an opt-in arrow driven by the page around it, so
// the Overview, the Inbox queue, a teammate's profile and every engagements
// sub-page but Active had no way to reorder anything at all.
//
// Every header is now a menu owned by the table, which is what the founder
// asked for after the Tasks page got the same treatment: "how the tasks looks
// needs to be similar to how the engagements look and function in a similar
// process."
describe("every column header sorts and filters, on every list", () => {
  const ROWS = [
    row({
      id: "s1",
      title: "Alpha",
      clientName: "Zeta Corp",
      type: "t1",
      stage: "in_review",
    }),
    row({
      id: "s2",
      title: "Beta",
      clientName: "Acme Ltd",
      type: "bookkeeping",
      stage: "collecting",
    }),
  ];

  function renderTable(props: Record<string, unknown> = {}) {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorklistTable rows={ROWS} locale="en" emptyText="none" {...props} />
      </NextIntlClientProvider>,
    );
    return within(container);
  }

  const headerName = (label: string) =>
    en.Engagements.column_menu.replace("{label}", label);

  /**
   * Open a header menu by the column's label.
   *
   * pointerDown, not click: Radix's dropdown opens on the pointer, and a
   * synthetic click alone leaves the menu shut and every assertion below it
   * failing for the wrong reason.
   */
  function openHeader(q: ReturnType<typeof within>, label: string) {
    fireEvent.pointerDown(q.getByRole("button", { name: headerName(label) }), {
      button: 0,
      ctrlKey: false,
    });
  }

  /**
   * Shut the open menu.
   *
   * ⚠️ NOT COSMETIC. Radix's dropdown is modal, so while it is open the rest of
   * the page is aria-hidden — every getByRole against the table underneath
   * fails, and it fails looking exactly like the filter wiped the wrong rows.
   */
  function closeMenu() {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
  }

  it("gives the plain Overview a menu on every column", () => {
    const q = renderTable();
    for (const label of [
      en.Dashboard.wl_col_engagement,
      en.Dashboard.wl_col_client,
      en.Dashboard.wl_col_service,
      en.Dashboard.wl_col_items,
      en.Dashboard.wl_col_due,
      en.Dashboard.wl_col_started,
      en.Dashboard.wl_col_status,
    ]) {
      expect(
        q.getByRole("button", { name: headerName(label) }),
      ).toBeInTheDocument();
    }
  });

  it("actually reorders the rows — sorting is not just an arrow", async () => {
    const q = renderTable();
    openHeader(q, en.Dashboard.wl_col_client);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: en.Engagements.sort_asc }),
    );

    // Acme before Zeta, which is the reverse of the order handed in.
    const alpha = q.getByRole("link", { name: "Alpha" });
    const beta = q.getByRole("link", { name: "Beta" });
    expect(beta.compareDocumentPosition(alpha)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  // The point of a menu over a bare arrow: "sort by client" floats one client
  // to the top of a hundred rows; "only this client" answers the question.
  it("narrows to the ticked values", async () => {
    const q = renderTable();
    openHeader(q, en.Dashboard.wl_col_client);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Acme Ltd" }),
    );
    closeMenu();

    expect(q.queryByRole("link", { name: "Alpha" })).not.toBeInTheDocument();
    expect(q.getByRole("link", { name: "Beta" })).toBeInTheDocument();
  });

  // ⚠️ The founder caught exactly this on the Tasks page: "when there is no
  // tasks the top sorting bars are gone. They should be there no matter what."
  // The headers ARE the filter controls, so losing them with the last row takes
  // away the only way back.
  it("keeps the headers when a filter empties the list", async () => {
    const q = renderTable();
    // Acme's row is the bookkeeping one, so "Acme + personal tax" matches
    // nothing. (The menus only offer values the rows actually have, which is
    // why this takes two filters rather than one impossible value.)
    openHeader(q, en.Dashboard.wl_col_client);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Acme Ltd" }),
    );
    closeMenu();
    openHeader(q, en.Dashboard.wl_col_service);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: en.Engagements.wl_service_t1,
      }),
    );
    closeMenu();

    expect(q.queryByRole("link", { name: "Alpha" })).not.toBeInTheDocument();
    expect(q.queryByRole("link", { name: "Beta" })).not.toBeInTheDocument();
    expect(
      q.getByRole("button", { name: headerName(en.Dashboard.wl_col_client) }),
    ).toBeInTheDocument();
    expect(q.getByText(en.Engagements.tasks_none_match)).toBeInTheDocument();
  });

  // ⚠️ FOUND BY CLICKING IT ON THE LIVE SITE, not by a test: the count used to
  // be rendered by the page AROUND the table, which can only count what it
  // handed over. Tick one value in a column menu and it still read "10
  // engagements" above three rows.
  it("counts what is on screen after a filter, not what was handed in", async () => {
    const q = renderTable({ countLabel: (n: number) => `${n} engagements` });
    expect(q.getByText("2 engagements")).toBeInTheDocument();

    openHeader(q, en.Dashboard.wl_col_client);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Acme Ltd" }),
    );
    closeMenu();

    expect(q.getByText("1 engagements")).toBeInTheDocument();
  });

  // ⚠️ THE COLUMN SHOWS THE PRICED LINES NOW (#1274), not the four fixed types.
  // The types read "Custom" on most real work, which is exactly why the priced
  // lines exist — so a row that HAS them must never fall back to its type.
  it("shows the engagement's own service lines, not its type", () => {
    const q = renderTable({
      rows: [
        row({
          id: "sv",
          title: "Priced",
          type: "custom",
          serviceNames: ["Monthly bookkeeping", "Payroll"],
        }),
      ],
    });
    expect(q.getByText("Monthly bookkeeping, Payroll")).toBeInTheDocument();
    expect(
      q.queryByText(en.Engagements.wl_service_custom),
    ).not.toBeInTheDocument();
  });

  it("truncates past two, so one busy row cannot heighten the table", () => {
    const q = renderTable({
      rows: [
        row({
          id: "sv2",
          title: "Busy",
          serviceNames: ["A", "B", "C", "D"],
        }),
      ],
    });
    expect(q.getByText("A, B")).toBeInTheDocument();
    expect(
      q.getByText(en.Engagements.wl_service_more.replace("{count}", "2")),
    ).toBeInTheDocument();
  });

  // Every engagement made before #1274 has no priced lines at all.
  it("falls back to the type when there are no priced lines", () => {
    const q = renderTable({
      rows: [row({ id: "old", title: "Old", type: "t1", serviceNames: [] })],
    });
    expect(q.getByText(en.Engagements.wl_service_t1)).toBeInTheDocument();
  });

  // Founder, on Canopy: "click on the tasks like ex: 3/4 and it brings up a
  // screen of all those tasks for that specific engagement."
  it("the task count is a control, not just a number", () => {
    const q = renderTable();
    const counts = q.getAllByRole("button", { name: "1/2" });
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0]).not.toBeDisabled();
  });

  it("opens the panel on the row that was clicked", async () => {
    const q = renderTable();
    fireEvent.click(q.getAllByRole("button", { name: "1/2" })[0]);
    // The dialog is titled with that engagement, so the wrong row is visible
    // immediately rather than after someone acts on the wrong job's tasks.
    expect(await screen.findByRole("dialog")).toHaveTextContent("Alpha");
  });

  it("shows the service and the task count, in Canopy's words", () => {
    const q = renderTable();
    // Service items = what was sold; engagement items = the tasks inside it.
    expect(q.getByText(en.Engagements.wl_service_t1)).toBeInTheDocument();
    expect(q.getAllByText("1/2").length).toBe(ROWS.length);
  });
});

// A person has to be reachable from where you notice them. Before this, the
// assignee on a work row was plain text and the only route to a teammate was
// through Settings — which is why "view Sarah's work" ended up being a filter
// on your own list instead of a place you could go.
describe("the assignee is the way to the person", () => {
  it("links a named assignee to their profile", () => {
    const q = renderWorklist();
    const alex = q.getAllByRole("link", { name: "Alex" })[0];
    expect(alex).toHaveAttribute("href", "/settings/team/me");
  });

  it("leaves an unassigned row as plain text, not a link to nobody", () => {
    // Row D (Gagnon) has assigneeUserId null.
    const q = renderWorklist();
    expect(
      q.queryByRole("link", { name: en.Dashboard.wl_unassigned }),
    ).toBeNull();
    expect(q.getAllByText(en.Dashboard.wl_unassigned).length).toBeGreaterThan(0);
  });

  it("does not link a name it has no id for", () => {
    const q = renderWorklist([
      { ...rows[0], assigneeUserId: null, assigneeName: "Ghost" },
    ]);
    expect(q.queryByRole("link", { name: "Ghost" })).toBeNull();
    expect(q.getByText("Ghost")).toBeInTheDocument();
  });
});

// Founder: "the completion rate slash progress of an engagement shall no longer
// be tracked based off the amount of documents have been received. It should be
// tracked based off the amount of tasks that are finished."
describe("Engagement items counts tasks", () => {
  // ⚠️ THE BAR IS GONE — the founder asked for Canopy's UI exactly, and its
  // Engagement items column is a value, not a gauge. The count says everything
  // the bar did and one thing it could not: three tasks left is not thirty.
  it("shows how many of the tasks are done", () => {
    const q = renderWorklist([
      row({ id: "e1", title: "Half done", approvedPct: 0.5, awaitingPct: 0.25, tasksDone: 2, tasksTotal: 4 }),
    ]);
    expect(q.getByText("2/4")).toBeInTheDocument();
    expect(q.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("shows nothing at all for a job with no tasks yet", () => {
    // "0/0" would say "started and got nowhere" about work nobody has planned.
    // An em-dash says the honest thing: there is nothing to measure.
    const q = renderWorklist([
      row({ id: "e2", title: "Nothing planned", approvedPct: 0, awaitingPct: 0, tasksDone: 0, tasksTotal: 0 }),
    ]);
    const tr = q.getByRole("link", { name: /Nothing planned/i }).closest("tr")!;
    expect(within(tr as HTMLElement).getAllByText("—").length).toBeGreaterThan(0);
    expect(q.queryAllByRole("progressbar")).toHaveLength(0);
  });
});
