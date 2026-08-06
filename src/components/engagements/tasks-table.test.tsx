import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: (...a: unknown[]) => toastSuccess(...(a as [])),
  },
}));
const reorderTasksAction = vi.fn(async () => ({ ok: true }));
const updateTaskAction = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/actions/engagement-tasks", () => ({
  updateTaskAction: (...a: unknown[]) => updateTaskAction(...(a as [])),
  deleteTaskAction: vi.fn(async () => ({ ok: true })),
  setTaskAssigneeAction: vi.fn(async () => ({ ok: true })),
  bulkUpdateTasksAction: vi.fn(async () => ({ ok: true, done: 0 })),
  reorderTasksAction: (...a: unknown[]) => reorderTasksAction(...(a as [])),
}));
// The detail panel this table opens now carries a comment thread that fetches
// its own rows on mount; unmocked it reaches cookies() outside a request scope.
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

import { TasksTable, type TaskRow } from "./tasks-table";

const STATUSES = [
  { id: "s-todo", name: "To do", color: "#64748b", bucket: "todo" as const },
  { id: "s-review", name: "Needs review", color: "#2563eb", bucket: "doing" as const },
  { id: "s-done", name: "Done", color: "#16a34a", bucket: "done" as const },
];

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

// Distinct client ids on purpose: the Client menu keys by ID, so a fixture
// that shares one would offer a single option and prove nothing about filtering.
const base = { engagementId: "e-1", notes: null } as const;

const TASKS: TaskRow[] = [
  {
    ...base,
    id: "t-late",
    title: "Zulu overdue thing",
    kind: "task",
    status: "todo",
    statusId: "s-todo",
    priority: "high",
    assigneeIds: ["u-tyler"],
    clientId: "c-aber",
    clientName: "Abercrombie",
    dueDate: "2020-01-01",
  },
  {
    ...base,
    id: "t-nodate",
    title: "Alpha no date",
    kind: "document_collection",
    status: "doing",
    statusId: "s-review",
    priority: "none",
    assigneeIds: [],
    clientId: "c-zen",
    clientName: "Zenith",
    dueDate: null,
  },
  {
    ...base,
    id: "t-soon",
    title: "Mike soon",
    kind: "signatures",
    status: "todo",
    statusId: "s-todo",
    priority: "low",
    assigneeIds: ["u-zach"],
    clientId: "c-mat",
    clientName: "Mathieu",
    dueDate: "2099-06-01",
  },
  {
    ...base,
    id: "t-done",
    title: "Delta finished",
    kind: "task",
    status: "done",
    statusId: "s-done",
    priority: "medium",
    assigneeIds: ["u-tyler"],
    clientId: "c-beta",
    clientName: "Beta",
    dueDate: "2021-01-01",
  },
];

// Radix's DropdownMenu leans on a few DOM APIs happy-dom does not implement.
// Same shim the worklist test already uses; plain assignments survive
// vi.restoreAllMocks.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  cleanup();
  toastSuccess.mockClear();
  updateTaskAction.mockClear();
  updateTaskAction.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

/** Radix opens on POINTER-DOWN, not click. Every column header is a menu now. */
function openColumn(label: string) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `${label} — sort and filter` }),
    { button: 0, ctrlKey: false },
  );
}

/**
 * Tick a filter option and close the menu.
 *
 * The menu deliberately STAYS OPEN when you tick something — narrowing to
 * three people should not cost three trips to the same button. But an open
 * Radix menu marks the rest of the page inert, so the table behind it is
 * unreachable until it is dismissed.
 */
async function pickValue(column: string, option: string) {
  openColumn(column);
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: option }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

async function pickSort(column: string, direction: string) {
  openColumn(column);
  fireEvent.click(await screen.findByRole("menuitem", { name: direction }));
}

const C = en.Engagements;

/** The saved-view tabs, scoped — "Unassigned" also names the assignee cell on
 *  every unassigned row, so an unscoped query is ambiguous. */
const tab = (name: RegExp) =>
  within(screen.getByRole("tablist")).getByRole("button", { name });

function renderTable(props: Partial<React.ComponentProps<typeof TasksTable>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TasksTable
        tasks={TASKS}
        members={MEMBERS}
        canEdit
        // The firm's own statuses, named and coloured (1420). The table reads
        // the BUCKET for every rule and the label only for display, which is
        // exactly what these fixtures let the tests prove.
        statuses={STATUSES}
        currentUserId="u-tyler"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** The task-name button in each body row, in the order they are rendered. */
const names = () =>
  screen
    .getAllByRole("button", { name: /^Details for / })
    .map((b) => b.textContent?.trim());

describe("TasksTable — the saved views", () => {
  it("opens on Active work, which hides what is finished", () => {
    renderTable();
    expect(names()).not.toContain("Delta finished");
    expect(names()).toContain("Zulu overdue thing");
  });

  // Founder: "The unnasigned and completed tab bars for sorting should be
  // removed like provided in the screenshot i sent." Both survive as FILTERS,
  // so nothing became unreachable — it stopped being a tab.
  // ⚠️ CAUGHT ON THE LIVE SITE. The engagements list opens this table from a
  // job's TOTAL ("2/2"), and on a fully-finished job the default "Active work"
  // view showed "Nothing planned on your side yet" under a count of two.
  it("can open on a view other than Active work", () => {
    renderTable({ initialView: "all" });
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    const all = tabs.find((el) => /All work/.test(el.textContent ?? ""));
    expect(all).toHaveAttribute("aria-selected", "true");
  });

  // ⚠️ FOUND BY EYE ON THE DEPLOYED PAGE, not by a test. On one engagement this
  // strip sat 90px under the page's OWN tab row (Manage tasks / Services /
  // Client view) — two tab rows stacked, which reads as a rendering mistake.
  // Canopy's engagement page has no such strip either.
  //
  // It was also wrong, not just noisy: "Active work" hid a job whose two tasks
  // were both finished, printing "Nothing planned on your side yet" underneath
  // a count of two.
  it("has no saved-view strip on a single job, and shows all its tasks", () => {
    renderTable({
      variant: "job",
      tasks: [
        {
          ...base,
          id: "t1",
          title: "Done thing",
          kind: "task" as const,
          status: "done" as const,
          statusId: "s-done",
          priority: "none" as const,
          assigneeIds: [],
          clientId: "c-aber",
          clientName: "Abercrombie",
          dueDate: null,
        },
        {
          ...base,
          id: "t2",
          title: "Live thing",
          kind: "task" as const,
          status: "doing" as const,
          statusId: "s-doing",
          priority: "none" as const,
          assigneeIds: [],
          clientId: "c-aber",
          clientName: "Abercrombie",
          dueDate: null,
        },
      ],
    });
    expect(screen.queryByRole("tablist")).toBeNull();
    // The finished one is still listed — that is the half "Active work" hid.
    expect(screen.getByText("Done thing")).toBeInTheDocument();
    expect(screen.getByText("Live thing")).toBeInTheDocument();
  });

  it("keeps only three tabs: Active, Mine, All", () => {
    renderTable();
    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map((b) => b.textContent?.replace(/\d+/g, "").trim());
    expect(tabs).toEqual([
      C.view_active,
      C.view_mine,
      C.view_all,
    ]);
  });

  it("still answers 'what is unassigned', from the Assignee column", async () => {
    renderTable();
    await pickValue(C.col_assignee as string, C.work_unassigned as string);
    expect(names()).toEqual(["Alpha no date"]);
  });

  it("still answers 'what is done', from the Status column", async () => {
    renderTable();
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: /All work/ }));
    await pickValue(C.col_status as string, "Done");
    expect(names()).toEqual(["Delta finished"]);
  });
});

describe("TasksTable — a header is a menu, not an arrow", () => {
  // Founder: "it's actually the most redundant sorting I've ever seen...
  // clicking on it should actually bring you up a drop down to sort and, like,
  // select specific clients."
  it("narrows to one client — the thing an arrow could never do", async () => {
    renderTable();
    await pickValue(C.col_client as string, "Mathieu");
    expect(names()).toEqual(["Mike soon"]);
  });

  it("narrows by task type, and by priority", async () => {
    renderTable();
    await pickValue(C.col_kind as string, C.kind_signatures as string);
    expect(names()).toEqual(["Mike soon"]);

    await pickValue(C.col_kind as string, C.kind_signatures as string); // untick
    await pickValue(C.col_priority as string, C.priority_high as string);
    expect(names()).toEqual(["Zulu overdue thing"]);
  });

  it("sorts in a direction worded for the column", async () => {
    renderTable();
    await pickSort(C.col_due as string, C.sort_latest as string);
    expect(names()[0]).toBe("Alpha no date");

    await pickSort(C.col_due as string, C.sort_earliest as string);
    expect(names()).toEqual(["Zulu overdue thing", "Mike soon", "Alpha no date"]);
  });

  it("ranks priority by rank, never alphabetically", async () => {
    // Alphabetically 'high' sits between 'none' and 'medium'.
    renderTable();
    await pickSort(C.col_priority as string, C.sort_highest as string);
    expect(names()[0]).toBe("Zulu overdue thing");
  });

  it("gives Task name no menu at all — there is nothing to narrow a name by", () => {
    renderTable();
    expect(
      screen.queryByRole("button", {
        name: `${C.col_task} — sort and filter`,
      }),
    ).toBeNull();
    expect(screen.getByText(C.col_task as string)).toBeTruthy();
  });

  it("offers a way back out of a filter it applied", async () => {
    renderTable();
    await pickValue(C.col_kind as string, C.kind_signatures as string);
    expect(names()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: C.filters_clear as string }));
    expect(names()).toHaveLength(3);
  });

  it("says so when nothing matches, rather than showing the blank-slate copy", async () => {
    renderTable();
    await pickValue(C.col_assignee as string, "Zachary Thresh");
    await pickValue(C.col_kind as string, C.kind_document_collection as string);
    expect(screen.getByText(C.tasks_none_match as string)).toBeTruthy();
  });
});

describe("TasksTable — the row", () => {
  // Founder: "clicking on the task name shouldn't be the only way to bring up
  // the sidebar. I think clicking on the task itself should bring up the
  // sidebar. like, the entire thing."
  it("opens the panel from anywhere on the row", () => {
    renderTable();
    const row = screen
      .getByRole("button", { name: /Details for Mike soon/ })
      .closest("tr")!;
    fireEvent.click(row);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("does NOT open it when you meant to tick the status off", () => {
    renderTable();
    const row = screen
      .getByRole("button", { name: /Details for Mike soon/ })
      .closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /^Change the status/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Founder: "you wanna actually click on it and see the specific document
  // collection on the engagement... a link that brings you to the actual doc
  // collection within the engagement, like, full page view."
  it("makes the task type a doorway into that collection, opened", () => {
    renderTable();
    const row = screen
      .getByRole("button", { name: /Details for Alpha no date/ })
      .closest("tr")!;
    const link = within(row).getByRole("link", {
      name: C.kind_document_collection as string,
    });
    expect(link.getAttribute("href")).toBe("/engagements/e-1?task=t-nodate");
  });

  it("leaves a plain task as plain text — a link to nowhere is worse than none", () => {
    renderTable();
    const row = screen
      .getByRole("button", { name: /Details for Zulu overdue thing/ })
      .closest("tr")!;
    expect(
      within(row).queryByRole("link", { name: C.kind_task as string }),
    ).toBeNull();
  });
});

describe("TasksTable — the two screens", () => {
  it("drops the Client column on a job, where every row has the same answer", () => {
    renderTable({ variant: "job" });
    expect(
      screen.queryByRole("button", {
        name: `${C.col_client} — sort and filter`,
      }),
    ).toBeNull();
  });

  it("keeps it on the firm-wide list, where it is the thing that varies", () => {
    renderTable({ variant: "firm" });
    expect(
      screen.getByRole("button", {
        name: `${C.col_client} — sort and filter`,
      }),
    ).toBeTruthy();
  });

  it("marks an overdue row, and never an overdue one that is already done", async () => {
    renderTable({ variant: "firm" });
    const overdueRow = screen
      .getByRole("button", { name: /Details for Zulu overdue thing/ })
      .closest("tr")!;
    expect(within(overdueRow).getByText("01/01/20").className).toContain(
      "text-destructive",
    );

    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: /All work/ }));
    const doneRow = screen
      .getByRole("button", { name: /Details for Delta finished/ })
      .closest("tr")!;
    expect(within(doneRow).getByText("01/01/21").className).not.toContain(
      "text-destructive",
    );
  });
});

// Founder: "it's too fast, and there's no actual check mark. It just disappears
// instantly... there should be a little pop up from the bottom that says undo."
//
// The per-row box that used to do this is GONE — it had become one of two boxes
// sitting side by side once bulk selection arrived, and the founder: "there
// shouldnt be 2 rows of circle selectors... MERGE THE TWO TOGETHER/GETRID OF
// THE RIGHT SIDE ONE." Finishing work now goes through the selection that was
// already there. Every guarantee below is unchanged, which is the point.
describe("TasksTable — finishing a task is a moment, not a disappearance", () => {
  /** Tick a row, then hit Mark done on the bulk bar. */
  const finish = (...titles: string[]) => {
    for (const title of titles) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: new RegExp(`Select ${title}`) }),
      );
    }
    fireEvent.click(
      screen.getByRole("button", { name: en.Engagements.task_mark_done_bulk }),
    );
  };

  it("has ONE box per row — the second one is what got merged away", () => {
    renderTable();
    const row = screen
      .getByRole("button", { name: /Details for Mike soon/ })
      .closest("tr")!;
    // Not "one checkbox and one button that looks like a checkbox" — one
    // control, full stop.
    expect(within(row).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(row).queryByRole("button", { name: /Mark Mike soon done/ }),
    ).toBeNull();
  });

  it("keeps the row in place after it is ticked, so the check can be seen", () => {
    renderTable();
    expect(names()).toContain("Mike soon");

    finish("Mike soon");

    // Still there, even though "Active work" no longer describes it. A row that
    // vanishes on the same frame as the click reads as "something happened, no
    // idea what" — and leaves nothing to undo from.
    expect(names()).toContain("Mike soon");
  });

  it("offers Undo for exactly as long as the row lingers", () => {
    renderTable();
    finish("Mike soon");

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, opts] = toastSuccess.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toContain("Mike soon");
    expect(opts.action.label).toBe(en.Engagements.undo);
    // The SAME length as the linger on purpose: an undo that outlives the row
    // it refers to points at nothing.
    expect(opts.duration).toBe(5000);
  });

  it("puts a task back where it WAS, not to a generic To do", () => {
    // "Alpha no date" sits in the firm's "Needs review". Undoing its completion
    // must return it there — coming back as untouched would lose a state
    // somebody deliberately set.
    renderTable();
    finish("Alpha no date");
    const [, opts] = toastSuccess.mock.calls.at(-1) as [
      string,
      { action: { onClick: () => void } },
    ];
    opts.action.onClick();

    expect(updateTaskAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: "t-nodate", statusId: "s-review" }),
    );
  });

  it("undoes TWELVE tasks to twelve different places, not all to To do", () => {
    // The reason this is not one bulk write. "Alpha no date" was in the firm's
    // "Needs review" and "Mike soon" was not; bringing both back as the same
    // status would quietly flatten a state somebody set on purpose.
    renderTable();
    finish("Alpha no date", "Mike soon");

    const [, opts] = toastSuccess.mock.calls.at(-1) as [
      string,
      { action: { onClick: () => void } },
    ];
    updateTaskAction.mockClear();
    opts.action.onClick();

    expect(updateTaskAction).toHaveBeenCalledTimes(2);
    expect(updateTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-nodate", statusId: "s-review" }),
    );
    expect(updateTaskAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-soon", statusId: "s-review" }),
    );
  });
});

// Founder: "make the tasks box a little shorter. It extendeds pretty long."
// The Overview shows this table as a PANEL among other panels, so it caps the
// rows — but the cap is on what is DRAWN, never on what is counted.
describe("TasksTable — capped, for the Overview", () => {
  it("draws only maxRows, and offers the rest", () => {
    renderTable({ maxRows: 2, moreHref: "/work" });
    expect(names()).toHaveLength(2);
    expect(screen.getByRole("link", { name: /1 more/ }).getAttribute("href")).toBe(
      "/work",
    );
  });

  it("still COUNTS everything — a truncated list that under-reports is one you cannot trust", () => {
    renderTable({ maxRows: 2, moreHref: "/work" });
    // Three tasks are active; only two are drawn.
    expect(
      within(screen.getByRole("tablist")).getByRole("tab", { name: /Active work/ })
        .textContent,
    ).toContain("3");
  });

  it("offers nothing extra when everything already fits", () => {
    renderTable({ maxRows: 10, moreHref: "/work" });
    expect(screen.queryByRole("link", { name: /more/ })).toBeNull();
  });

  it("is uncapped by default — the Tasks page shows the lot", () => {
    renderTable();
    expect(names()).toHaveLength(3);
  });
});

// ── LEAVING A SAVED VIEW ────────────────────────────────────────────────────
//
// Founder: "saved views work but dont reset when you swap back to a different
// view". You clicked Active work and landed there with the saved view's filters
// still applied — the tab said one thing and the list showed another.
//
// The tabs on THIS list are client state, not routes, so nothing remounts to
// clear them. (The engagements list does not have this bug for exactly that
// reason: its tabs are links.)
describe("TasksTable — a saved view lets go when you leave it", () => {
  const VIEW = {
    id: "sv-1",
    name: "Doc Requests",
    filters: { view: "all", kindFilter: ["document_collection"] },
  };

  it("clears the view's filters when a built-in tab is clicked", async () => {
    renderTable({ savedViews: [VIEW] });

    // On the saved view: filtered down.
    fireEvent.click(screen.getByRole("tab", { name: /Doc Requests/i }));
    const filtered = names().length;
    expect(screen.getByText(en.Engagements.filters_clear)).toBeTruthy();

    // Back to a built-in tab: the filter chip is gone and more rows are back.
    fireEvent.click(
      screen.getByRole("tab", { name: new RegExp(en.Engagements.view_all, "i") }),
    );
    await waitFor(() =>
      expect(screen.queryByText(en.Engagements.filters_clear)).toBeNull(),
    );
    expect(names().length).toBeGreaterThan(filtered);
  });

  it("stops calling itself the saved view once a filter is changed by hand", () => {
    renderTable({ savedViews: [VIEW] });
    const tab = screen.getByRole("tab", { name: /Doc Requests/i });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");

    // Any hand-made filter change means the list no longer matches what was
    // saved, so the tab must stop claiming otherwise.
    fireEvent.click(screen.getByText(en.Engagements.filters_clear));
    expect(tab.getAttribute("aria-selected")).toBe("false");
  });
});


// ── THE CARD LAYOUT ─────────────────────────────────────────────────────────
//
// Founder, with Karbon's board open: "I'm very fond of the like box look... And
// you should make the color of the task align with the status of the task, so
// the colors can change depending on the status of it."
//
// These hold the two claims that matter: the cards are the SAME component in a
// different skin, and the colour on a card is the firm's status colour rather
// than anything this file invented.
describe("TasksTable — cards, on an engagement", () => {
  const cards = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[style*="--task-hue"]'));

  it("draws a card per task and no table at all", () => {
    renderTable({ layout: "cards", variant: "job" });
    expect(document.querySelector("table")).toBeNull();
    expect(cards().length).toBeGreaterThan(0);
  });

  it("paints each card in its own STATUS colour, not a palette of its own", () => {
    // The point of keying colour to status: the hue is one the firm picked on
    // the Task statuses page, so changing it there changes every card wearing
    // it. A colour this file chose would be a second palette to keep in sync.
    renderTable({ layout: "cards", variant: "job" });
    const hues = cards().map((c) => c.style.getPropertyValue("--task-hue").trim());
    expect(hues.every(Boolean)).toBe(true);
    // Every hue on screen has to be one of the firm's.
    const known = new Set(STATUSES.map((s) => s.color));
    for (const h of hues) expect(known.has(h)).toBe(true);
  });

  it("keeps the row's own status menu rather than growing a second one", () => {
    // Two controls that write a status is exactly the drift the founder
    // complained about once already.
    renderTable({ layout: "cards", variant: "job" });
    expect(
      screen.getAllByRole("button", { name: /^Change the status of/ }).length,
    ).toBe(cards().length);
  });

  it("keeps the order the server sent instead of re-sorting by date", () => {
    // ⚠️ THE BUG THAT MADE DRAGGING LOOK BROKEN. The drop wrote order_index
    // correctly — the database really did reorder — but the grid then applied
    // the table's newest-first default on top, so the arrangement was
    // persisted and immediately discarded. The screen never moved, and the
    // founder reported "dragging doesnt work" against code whose write was
    // working perfectly.
    //
    // listEngagementTasks already returns rows in order_index, so the cards'
    // job is simply not to touch that.
    renderTable({ layout: "cards", variant: "job" });
    const titles = cards().map((c) => c.querySelector("p")?.textContent?.trim());
    expect(titles).toEqual(TASKS.map((t) => t.title));
  });

  it("sends the WHOLE new order on a drop, not just the moved task", () => {
    // The server renumbers from the array. Sending "task X moved to slot 3"
    // would depend on order_index already being a dense sequence, which it has
    // never been — createEngagementTask leaves gaps on every delete.
    renderTable({ layout: "cards", variant: "job" });
    const handles = screen.getAllByLabelText(/^Drag to reorder/);
    // A stand-in for the real DataTransfer. setData is not decoration: Safari
    // refuses to begin a drag without a payload, which is why the first
    // version did nothing at all there.
    // A stand-in for the real DataTransfer that actually STORES the payload —
    // the drop reads the dragged id back out of it, so a mock that only
    // records the call would pass while the feature could not work.
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: vi.fn((k: string, v: string) => { store[k] = v; }),
      getData: (k: string) => store[k] ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(handles[0], { dataTransfer });
    // ⚠️ The id must be ON the event. Reading it from React state instead was
    // why a second drag in one session silently did nothing: the state had not
    // committed, dropOn returned one line in, and no write ever went out.
    expect(store["text/plain"]).toBe(TASKS[0].id);

    // ⚠️ DROP ON THE CARD, not the handle. A handle is ~14px and only appears
    // on hover, so requiring the release to land on one is why the founder
    // said "dragging doesnt work".
    fireEvent.dragOver(cards()[1], { dataTransfer });
    fireEvent.drop(cards()[1], { dataTransfer });

    // Asserted through expect() rather than by casting mock.calls — the mock's
    // arg tuple is typed as empty, and casting past that is the exact thing
    // only `tsc --noEmit` objects to (it passes vitest and next build happily).
    const ids = TASKS.map((t) => t.id);
    expect(reorderTasksAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderedIds: expect.arrayContaining([ids[0], ids[1]]),
      }),
    );
  });
});
