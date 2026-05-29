import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EngagementsWorklist, type WorklistRow } from "./engagements-worklist";
import en from "../../../messages/en.json";

// Stub the locale-aware <Link> (needs next/navigation, absent under vitest)
// with a plain anchor so we can assert the href each row produces.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

// A base row with sane defaults; each fixture overrides what it needs.
function row(over: Partial<WorklistRow> & Pick<WorklistRow, "id" | "title">): WorklistRow {
  return {
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
    ...over,
  };
}

// A = overdue + mine, B = stale + someone else's, C = clean + mine + newest,
// D = clean + unassigned + draft + oldest.
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
];

// Scope every query to *this* render's container. RTL's bound queries (and
// the global `screen`) default to document.body, so a worklist left mounted
// by an earlier test — with a stale search term or filter — would otherwise
// bleed into the next test's assertions.
function renderWorklist(items: WorklistRow[] = rows, currentUserId = "me") {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementsWorklist
        rows={items}
        currentUserId={currentUserId}
        locale="en"
      />
    </NextIntlClientProvider>,
  );
  return within(container);
}

describe("EngagementsWorklist", () => {
  it("defaults to Needs attention: only flagged rows, most urgent first", () => {
    const q = renderWorklist();

    const a = q.getByRole("link", { name: /Smith T1/i });
    const b = q.getByRole("link", { name: /Jones Bookkeeping/i });
    expect(a).toHaveAttribute("href", "/engagements/a");
    expect(b).toHaveAttribute("href", "/engagements/b");

    // Clean engagements stay out of the attention view.
    expect(q.queryByRole("link", { name: /Tremblay T2/i })).not.toBeInTheDocument();
    expect(q.queryByRole("link", { name: /Gagnon Custom/i })).not.toBeInTheDocument();

    // Higher attention score (overdue) sorts above stale.
    expect(a.compareDocumentPosition(b)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // The pill carries the flagged count.
    expect(q.getByRole("tab", { name: /needs attention/i })).toHaveTextContent("2");
  });

  it("shows every engagement under All", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("tab", { name: en.Dashboard.wl_filter_all }));

    for (const name of [
      /Smith T1/i,
      /Jones Bookkeeping/i,
      /Tremblay T2/i,
      /Gagnon Custom/i,
    ]) {
      expect(q.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("limits Mine to engagements assigned to the current user", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("tab", { name: en.Dashboard.wl_filter_mine }));

    expect(q.getByRole("link", { name: /Smith T1/i })).toBeInTheDocument();
    expect(q.getByRole("link", { name: /Tremblay T2/i })).toBeInTheDocument();
    // Assigned to someone else / unassigned → hidden.
    expect(q.queryByRole("link", { name: /Jones Bookkeeping/i })).not.toBeInTheDocument();
    expect(q.queryByRole("link", { name: /Gagnon Custom/i })).not.toBeInTheDocument();
  });

  it("surfaces clean engagements under Recent, newest first", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("tab", { name: en.Dashboard.wl_filter_recent }));

    const c = q.getByRole("link", { name: /Tremblay T2/i });
    const a = q.getByRole("link", { name: /Smith T1/i });
    expect(c).toBeInTheDocument();
    // C (Mar 20) is more recent than A (Mar 02), so it sorts first.
    expect(c.compareDocumentPosition(a)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    expect(q.queryByRole("link")).not.toBeInTheDocument();
  });

  it("labels unassigned engagements", () => {
    const q = renderWorklist();
    fireEvent.click(q.getByRole("tab", { name: en.Dashboard.wl_filter_all }));

    // Gagnon's row carries the unassigned label.
    const gagnon = q
      .getByRole("link", { name: /Gagnon Custom/i })
      .closest("tr") as HTMLElement;
    expect(within(gagnon).getByText(en.Dashboard.wl_unassigned)).toBeInTheDocument();
  });
});
