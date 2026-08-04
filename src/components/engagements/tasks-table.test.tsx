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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/actions/engagement-tasks", () => ({
  updateTaskAction: vi.fn(async () => ({ ok: true })),
  deleteTaskAction: vi.fn(async () => ({ ok: true })),
  setTaskAssigneeAction: vi.fn(async () => ({ ok: true })),
}));

import { TasksTable, type TaskRow } from "./tasks-table";

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

const base = {
  clientId: "c-1",
  engagementId: "e-1",
  notes: null,
} as const;

const TASKS: TaskRow[] = [
  {
    ...base,
    id: "t-late",
    title: "Zulu overdue thing",
    kind: "task",
    status: "todo",
    priority: "high",
    assigneeIds: ["u-tyler"],
    clientName: "Abercrombie",
    dueDate: "2020-01-01",
  },
  {
    ...base,
    id: "t-nodate",
    title: "Alpha no date",
    kind: "document_collection",
    status: "doing",
    priority: "none",
    assigneeIds: [],
    clientName: "Zenith",
    dueDate: null,
  },
  {
    ...base,
    id: "t-soon",
    title: "Mike soon",
    kind: "signatures",
    status: "todo",
    priority: "low",
    assigneeIds: ["u-zach"],
    clientName: "Mathieu",
    dueDate: "2099-06-01",
  },
  {
    ...base,
    id: "t-done",
    title: "Delta finished",
    kind: "task",
    status: "done",
    priority: "medium",
    assigneeIds: ["u-tyler"],
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

beforeEach(() => cleanup());
afterEach(() => cleanup());

/** Radix opens on POINTER-DOWN, not click. */
function openFilter(name: RegExp) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
  });
}

/**
 * Tick a filter option and close the menu.
 *
 * The menu deliberately STAYS OPEN when you tick something — narrowing to
 * three people should not cost three trips to the same button. But an open
 * Radix menu marks the rest of the page inert, so the table behind it is
 * unreachable until it is dismissed.
 */
async function pickFilter(menu: RegExp, option: string) {
  openFilter(menu);
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: option }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

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

  it("has a view for the three questions people actually arrive with", () => {
    renderTable();

    fireEvent.click(tab(/My work/));
    // Tyler's, and not the done one — "my work" means what is left.
    expect(names()).toEqual(["Zulu overdue thing"]);

    fireEvent.click(tab(/Unassigned/));
    expect(names()).toEqual(["Alpha no date"]);

    fireEvent.click(tab(/Completed/));
    expect(names()).toEqual(["Delta finished"]);

    fireEvent.click(tab(/All work/));
    expect(names()).toHaveLength(4);
  });

  it("counts on the tab, so 'is anything unassigned' needs no click", () => {
    renderTable();
    expect(tab(/Unassigned/).textContent).toContain("1");
  });
});

describe("TasksTable — sorting", () => {
  it("sorts by due date first, with no-date LAST rather than earliest", () => {
    // An empty date is not "the most urgent thing in the firm", which is what
    // sorting a blank string ascending would make it.
    renderTable();
    expect(names()).toEqual(["Zulu overdue thing", "Mike soon", "Alpha no date"]);
  });

  it("reverses on a second click of the same column", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: en.Engagements.col_due as string }));
    expect(names()[0]).toBe("Alpha no date");
  });

  it("ranks priority high → none, never alphabetically", () => {
    // Alphabetically 'high' sits between 'none' and 'medium', which is the
    // opposite of what the column is for.
    renderTable();
    fireEvent.click(
      screen.getByRole("button", { name: en.Engagements.col_priority as string }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.Engagements.col_priority as string }),
    );
    expect(names()[0]).toBe("Zulu overdue thing"); // high
  });

  it("sorts by name and by client too", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: en.Engagements.col_task as string }));
    expect(names()).toEqual(["Alpha no date", "Mike soon", "Zulu overdue thing"]);

    fireEvent.click(screen.getByRole("button", { name: en.Engagements.col_client as string }));
    expect(names()).toEqual(["Zulu overdue thing", "Mike soon", "Alpha no date"]);
  });
});

describe("TasksTable — filtering", () => {
  it("narrows by task type and says how many are showing", async () => {
    renderTable();
    await pickFilter(/Filter by Task type/, en.Engagements.kind_signatures as string);
    expect(names()).toEqual(["Mike soon"]);
    expect(screen.getByText("1 task")).toBeTruthy();
  });

  it("treats Unassigned as a real answer in the assignee filter", async () => {
    renderTable();
    await pickFilter(/Filter by Assignee/, en.Engagements.work_unassigned as string);
    expect(names()).toEqual(["Alpha no date"]);
  });

  it("says so when nothing matches, rather than showing the blank-slate copy", async () => {
    renderTable();
    await pickFilter(/Filter by Assignee/, "Zachary Thresh");
    await pickFilter(/Filter by Task type/, en.Engagements.kind_document_collection as string);
    expect(
      screen.getByText(en.Engagements.tasks_none_match as string),
    ).toBeTruthy();
  });

  it("offers a way back out of a filter it applied", async () => {
    renderTable();
    await pickFilter(/Filter by Task type/, en.Engagements.kind_signatures as string);
    fireEvent.click(
      screen.getByRole("button", { name: en.Engagements.filters_clear as string }),
    );
    expect(names()).toHaveLength(3);
  });
});

describe("TasksTable — the two screens", () => {
  it("drops the Client column on a job, where every row has the same answer", () => {
    renderTable({ variant: "job" });
    expect(
      screen.queryByRole("button", { name: en.Engagements.col_client as string }),
    ).toBeNull();
  });

  it("keeps it on the firm-wide list, where it is the thing that varies", () => {
    renderTable({ variant: "firm" });
    expect(
      screen.getByRole("button", { name: en.Engagements.col_client as string }),
    ).toBeTruthy();
  });

  it("marks an overdue row, and never an overdue one that is already done", () => {
    renderTable({ variant: "firm" });
    const overdueRow = screen
      .getByRole("button", { name: /Details for Zulu overdue thing/ })
      .closest("tr")!;
    expect(within(overdueRow).getByText("01/01/20").className).toContain(
      "text-destructive",
    );

    fireEvent.click(tab(/Completed/));
    const doneRow = screen
      .getByRole("button", { name: /Details for Delta finished/ })
      .closest("tr")!;
    expect(within(doneRow).getByText("01/01/21").className).not.toContain(
      "text-destructive",
    );
  });
});
