import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import {
  TaskDetailPanel,
  type DetailTask,
  type TaskDetailPanelPatch,
} from "./task-detail-panel";

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

const TASK: DetailTask = {
  id: "t-1",
  title: "2025 T2 supporting documents",
  kind: "document_collection",
  status: "doing",
  priority: "none",
  assigneeIds: ["u-tyler"],
  clientId: "c-abc",
  engagementId: "e-1",
  clientName: "ABC Incorporation Inc",
  engagementTitle: "T2 Tax Return",
  notes: "Waiting on the bank statements.",
  dueDate: "2026-04-30",
};

const kindLabel = (k: string) =>
  k === "document_collection"
    ? (en.Engagements.kind_document_collection as string)
    : null;

// Typed, not `ReturnType<typeof vi.fn>`. An untyped mock is assignable to
// nothing, and `next build` and vitest both wave it through — only
// `tsc --noEmit` sees it, which is why tsc runs last here.
let onPatch: Mock<TaskDetailPanelPatch>;
let onClose: Mock<() => void>;
let onOpenScreen: Mock<(taskId: string) => void>;

beforeEach(() => {
  onPatch = vi.fn();
  onClose = vi.fn();
  onOpenScreen = vi.fn();
});
afterEach(() => cleanup());

function renderPanel(task: DetailTask | null = TASK, withScreen = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaskDetailPanel
        task={task}
        members={MEMBERS}
        canEdit
        kindLabel={kindLabel}
        onClose={onClose}
        onOpenScreen={withScreen ? onOpenScreen : undefined}
        onPatch={onPatch}
      />
    </NextIntlClientProvider>,
  );
}

describe("TaskDetailPanel", () => {
  it("renders nothing while no task is open", () => {
    renderPanel(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the task's own fields, not the category", () => {
    renderPanel();
    expect(
      (screen.getByLabelText(en.Engagements.add_task_name as string) as HTMLInputElement)
        .value,
    ).toBe("2025 T2 supporting documents");
    expect(screen.getByDisplayValue("Waiting on the bank statements.")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-04-30")).toBeTruthy();
    // The kind is a TAG, beside the name — never the name itself.
    expect(
      screen.getByText(en.Engagements.kind_document_collection as string),
    ).toBeTruthy();
  });

  // The list owns the write. The panel never calls a server action itself, so
  // a row and its panel cannot end up disagreeing about the same task.
  it("commits the name on blur, and only when it actually changed", () => {
    renderPanel();
    const field = screen.getByLabelText(
      en.Engagements.add_task_name as string,
    ) as HTMLInputElement;

    fireEvent.blur(field);
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "  Year-end AP confirmations  " } });
    // Still nothing: a write per keystroke is the lag this whole change removed.
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(onPatch).toHaveBeenCalledWith({ title: "Year-end AP confirmations" }, {});
  });

  it("refuses to blank the name, and puts the old one back", () => {
    renderPanel();
    const field = screen.getByLabelText(
      en.Engagements.add_task_name as string,
    ) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    expect(onPatch).not.toHaveBeenCalled();
    expect(field.value).toBe("2025 T2 supporting documents");
  });

  it("sends the whole new assignee list optimistically AND the single toggle to the server", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Zachary Thresh"));
    expect(onPatch).toHaveBeenCalledWith(
      { assigneeIds: ["u-tyler", "u-zach"] },
      { assigneeId: "u-zach", on: true },
    );

    onPatch.mockClear();
    fireEvent.click(screen.getByText("Tyler Jette"));
    expect(onPatch).toHaveBeenCalledWith(
      { assigneeIds: [] },
      { assigneeId: "u-tyler", on: false },
    );
  });

  it("sets a status directly rather than cycling to it", () => {
    renderPanel();
    fireEvent.click(screen.getByText(en.Clients.task_status_done as string));
    expect(onPatch).toHaveBeenCalledWith({ status: "done" }, {});
  });

  it("clears a due date to null rather than an empty string", () => {
    renderPanel();
    fireEvent.change(screen.getByDisplayValue("2026-04-30"), {
      target: { value: "" },
    });
    expect(onPatch).toHaveBeenCalledWith({ dueDate: null }, {});
  });

  it("offers a way into the task's screen, so the panel is not a dead end", () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(en.Engagements.kind_document_collection as string),
      }),
    );
    expect(onOpenScreen).toHaveBeenCalledWith("t-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("offers no such button for a plain task, which has no screen", () => {
    renderPanel({ ...TASK, kind: "task" });
    expect(
      screen.queryByRole("button", { name: /Open/i }),
    ).toBeNull();
  });
});
