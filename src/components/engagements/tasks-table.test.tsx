import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/react";
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
const updateTaskAction = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/actions/engagement-tasks", () => ({
  updateTaskAction: (...a: unknown[]) => updateTaskAction(...(a as [])),
  deleteTaskAction: vi.fn(async () => ({ ok: true })),
  setTaskAssigneeAction: vi.fn(async () => ({ ok: true })),
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
  it("keeps only three tabs: Active, Mine, All", () => {
    renderTable();
    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("button")
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
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: /All work/ }));
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

    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: /All work/ }));
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
describe("TasksTable — finishing a task is a moment, not a disappearance", () => {
  it("keeps the row in place after it is ticked, so the check can be seen", () => {
    renderTable();
    expect(names()).toContain("Mike soon");

    fireEvent.click(
      screen.getByRole("button", { name: /Mark Mike soon done/ }),
    );

    // Still there, even though "Active work" no longer describes it. A row that
    // vanishes on the same frame as the click reads as "something happened, no
    // idea what" — and leaves nothing to undo from.
    expect(names()).toContain("Mike soon");
  });

  it("offers Undo for exactly as long as the row lingers", () => {
    renderTable();
    fireEvent.click(
      screen.getByRole("button", { name: /Mark Mike soon done/ }),
    );

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
    fireEvent.click(
      screen.getByRole("button", { name: /Mark Alpha no date done/ }),
    );
    const [, opts] = toastSuccess.mock.calls.at(-1) as [
      string,
      { action: { onClick: () => void } },
    ];
    opts.action.onClick();

    expect(updateTaskAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: "t-nodate", statusId: "s-review" }),
    );
  });

  it("un-ticking needs no toast — the row coming back IS the confirmation", () => {
    renderTable();
    fireEvent.click(
      within(screen.getByRole("tablist")).getByRole("button", { name: /All work/ }),
    );
    toastSuccess.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: /Mark Delta finished done/ }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
