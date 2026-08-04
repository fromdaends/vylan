import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const addTaskAction = vi.fn(async () => ({ ok: true }));
const updateTaskAction = vi.fn(async () => ({ ok: true }));
const deleteTaskAction = vi.fn(async () => ({ ok: true }));
const setTaskAssigneeAction = vi.fn(async () => ({ ok: true }));

vi.mock("@/app/actions/engagement-tasks", () => ({
  addTaskAction: (...a: unknown[]) => addTaskAction(...(a as [])),
  updateTaskAction: (...a: unknown[]) => updateTaskAction(...(a as [])),
  deleteTaskAction: (...a: unknown[]) => deleteTaskAction(...(a as [])),
  setTaskAssigneeAction: (...a: unknown[]) => setTaskAssigneeAction(...(a as [])),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { SubtaskList } from "./subtask-list";

const STATUSES = [
  { id: "s-todo", name: "To do", color: "#64748b", bucket: "todo" as const },
  { id: "s-done", name: "Done", color: "#16a34a", bucket: "done" as const },
];
const MEMBERS = [{ id: "u-tyler", name: "Tyler Jette" }];

const SUBTASKS = [
  { id: "sub-1", title: "Review the W-2s", status: "todo" as const, assigneeIds: [] },
  { id: "sub-2", title: "Check the RRSP slips", status: "done" as const, assigneeIds: ["u-tyler"] },
];

beforeEach(() => {
  for (const m of [addTaskAction, updateTaskAction, deleteTaskAction, setTaskAssigneeAction]) {
    m.mockClear();
    m.mockResolvedValue({ ok: true });
  }
});
afterEach(() => cleanup());

function renderList(subtasks = SUBTASKS, canEdit = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SubtaskList
        parentId="t-parent"
        parentClientId="c-1"
        parentEngagementId="e-1"
        subtasks={subtasks}
        members={MEMBERS}
        statuses={STATUSES}
        canEdit={canEdit}
      />
    </NextIntlClientProvider>,
  );
}

describe("SubtaskList", () => {
  it("shows how many of the steps are done", () => {
    renderList();
    expect(screen.getByText("1 of 2 done")).toBeTruthy();
  });

  // A step under a task inherits its client and its job, so the only thing left
  // to say is what it IS. Asking six questions to add "Review the W-2s" is how
  // a checklist stops being used.
  it("adds a step from one field, carrying the parent down with it", async () => {
    renderList();
    const field = screen.getByLabelText(
      en.Engagements.subtasks_add_placeholder as string,
    );
    fireEvent.change(field, { target: { value: "  Reconcile the bank  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith({
      clientId: "c-1",
      engagementId: "e-1",
      title: "Reconcile the bank",
      // The one field that makes it a subtask. The database copies the client
      // and job FROM the parent regardless of what is sent here.
      parentId: "t-parent",
    });
  });

  it("ticks a step off in one click, and back again", async () => {
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: /Mark Review the W-2s done/ }),
    );
    await waitFor(() => expect(updateTaskAction).toHaveBeenCalledTimes(1));
    expect(updateTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "sub-1", statusId: "s-done" }),
    );

    updateTaskAction.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: /Mark Check the RRSP slips done/ }),
    );
    await waitFor(() => expect(updateTaskAction).toHaveBeenCalledTimes(1));
    expect(updateTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "sub-2", statusId: "s-todo" }),
    );
  });

  it("strikes through a finished step", () => {
    renderList();
    expect(screen.getByText("Check the RRSP slips").className).toContain(
      "line-through",
    );
    expect(screen.getByText("Review the W-2s").className).not.toContain(
      "line-through",
    );
  });

  it("offers no way to add or tick anything when you cannot edit", () => {
    renderList(SUBTASKS, false);
    expect(
      screen.queryByLabelText(en.Engagements.subtasks_add_placeholder as string),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Mark Review the W-2s done/ }),
    ).toBeDisabled();
  });

  it("shows the heading with no count when there are no steps yet", () => {
    renderList([]);
    expect(screen.getByText(en.Engagements.subtasks as string)).toBeTruthy();
    expect(screen.queryByText(/of .* done/)).toBeNull();
  });
});
