import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RepeatingView } from "./repeating-view";
import type { RepeatingRow } from "@/lib/recurring/list";
import en from "../../../messages/en.json";

// The screen can only be seen signed in, so this stands in for eyes-on: it
// proves the rows render, that the states which matter most (a silently
// auto-paused schedule, a departed assignee) actually say so on screen, and
// that the copy keys all resolve. A missing key or a bad conditional shows up
// as a failure here rather than as a blank cell in production.

const controlMock = vi.fn();
const reassignMock = vi.fn();
vi.mock("@/app/actions/recurring", () => ({
  seriesControlAction: (...a: unknown[]) => controlMock(...a),
  reassignSeriesAction: (...a: unknown[]) => reassignMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));
// next-intl's navigation module uses a bare "next/navigation" specifier that
// Next's bundler resolves but raw vitest ESM does not. Stubbing our Link
// wrapper keeps that module from loading at all.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children?: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const TODAY = { year: 2026, month: 8, day: 11 };

function row(over: Partial<RepeatingRow> = {}): RepeatingRow {
  return {
    id: "s-1",
    title: "Monthly bookkeeping",
    clientId: "c-1",
    clientName: "Acme Ltd",
    clientArchived: false,
    status: "active",
    frequency: "monthly",
    intervalMonths: null,
    anchorDay: 15,
    dueOffsetDays: 15,
    nextSpawnOn: "2026-08-15",
    pausedAt: null,
    endedAt: null,
    documentCount: 3,
    sourceEngagementId: "e-1",
    assigneeUserId: "u-sarah",
    assigneeName: "Sarah",
    assigneeWasRemoved: false,
    attention: null,
    ...over,
  };
}

function mount(rows: RepeatingRow[], opts: { isOwner?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RepeatingView
        rows={rows}
        locale="en"
        today={TODAY}
        currentUserId="u-me"
        isOwner={opts.isOwner ?? true}
        teamEnabled
        members={[
          { id: "u-sarah", name: "Sarah" },
          { id: "u-marc", name: "Marc" },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  controlMock.mockReset().mockResolvedValue({ ok: true });
  reassignMock.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("RepeatingView", () => {
  it("renders a schedule with its client, rhythm and next run", () => {
    mount([row()]);
    expect(screen.getByText("Monthly bookkeeping")).toBeTruthy();
    expect(screen.getByText("Acme Ltd")).toBeTruthy();
    // The three schema columns collapsed into one readable sentence.
    expect(screen.getByText("Monthly, on the 15th")).toBeTruthy();
    expect(screen.getByText("In 4 days")).toBeTruthy();
  });

  it("SAYS WHY a schedule auto-paused — the whole reason this screen exists", () => {
    // The spawner pauses these silently: no log, no notification. Before this
    // screen a firm could not find out at all.
    mount([
      row({
        id: "a",
        status: "paused",
        clientArchived: true,
        attention: "client_archived",
      }),
    ]);
    expect(screen.getByText("This client is archived")).toBeTruthy();
    expect(screen.getByText("Client archived")).toBeTruthy();
    // And never a stale date on a paused row — pauseSeriesAction leaves
    // next_spawn_on untouched, so the stored date is usually in the past.
    expect(screen.queryByText("In 4 days")).toBeNull();
    // "Paused" legitimately appears twice: the filter chip and the row.
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(1);
  });

  it("flags an empty checklist with its own reason", () => {
    mount([
      row({ status: "paused", documentCount: 0, attention: "empty_checklist" }),
    ]);
    expect(screen.getByText("Its document list is empty")).toBeTruthy();
  });

  it("warns when the assigned person has left, and shows who gets it instead", () => {
    mount([
      row({
        assigneeName: "Tyler",
        assigneeUserId: "u-owner",
        assigneeWasRemoved: true,
        attention: "assignee_removed",
      }),
    ]);
    expect(
      screen.getByText("That person has left — new work goes to an owner"),
    ).toBeTruthy();
    expect(screen.getByText("Tyler")).toBeTruthy();
  });

  it("teaches the real setup path when the firm has none", () => {
    mount([]);
    expect(screen.getByText("No repeating work yet")).toBeTruthy();
    expect(
      screen.getByText("Open its “…” menu and choose Repeat."),
    ).toBeTruthy();
  });

  it("hides stopped schedules until asked, then shows them", () => {
    mount([row({ status: "ended", endedAt: "2026-03-03", title: "Old one" })]);
    expect(screen.queryByText("Old one")).toBeNull();
    fireEvent.click(screen.getByText("Show stopped (1)"));
    expect(screen.getByText("Old one")).toBeTruthy();
  });

  it("counts each filter bucket from the rows actually shown", () => {
    mount([
      row({ id: "a" }),
      row({ id: "b", status: "paused", clientArchived: true, attention: "client_archived" }),
      row({ id: "c", status: "ended" }),
    ]);
    // All 2 (stopped excluded), Running 1, Paused 1, Needs attention 1.
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Needs attention/ }).textContent).toContain("1");
  });

  it("tells staff their list may be shorter, and never tells an owner that", () => {
    const { unmount } = mount([row()], { isOwner: false });
    expect(
      screen.getByText(/only visible to owners/),
    ).toBeTruthy();
    unmount();
    mount([row()], { isOwner: true });
    expect(screen.queryByText(/only visible to owners/)).toBeNull();
  });

  it("shows NO toolbar when the firm has no schedules at all", () => {
    // Chips reading zero, a "who it goes to" picker over nobody and a search
    // box over nothing is chrome for data that doesn't exist — it's what made
    // the empty screen look unfinished.
    mount([]);
    expect(screen.queryByRole("tab", { name: /All/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Search schedules or clients")).toBeNull();
    expect(screen.getByText("No repeating work yet")).toBeTruthy();
  });

  it("KEEPS the toolbar when a filter empties the list, so you can get back", () => {
    // The distinction that matters: no rows at all vs. no rows right now.
    // Hiding the controls here would strand you with no way to clear the search.
    mount([row()]);
    const search = screen.getByPlaceholderText("Search schedules or clients");
    fireEvent.change(search, { target: { value: "zzzznomatch" } });
    expect(screen.getByPlaceholderText("Search schedules or clients")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /All/ })).toBeTruthy();
    expect(screen.getByText("No schedule matches that.")).toBeTruthy();
  });

  it("gives every row an actions menu, labelled by schedule", () => {
    // The menu CONTENTS aren't asserted here — Radix renders them in a portal
    // on real pointer events, which happy-dom doesn't drive. The decision
    // behind the disabled Resume (resumeBlockedReason) is unit-tested directly
    // in lib/recurring/list.test.ts, which is where the logic actually lives.
    mount([row(), row({ id: "s-2", title: "Quarterly GST" })]);
    expect(screen.getByLabelText("Actions for Monthly bookkeeping")).toBeTruthy();
    expect(screen.getByLabelText("Actions for Quarterly GST")).toBeTruthy();
  });
});
