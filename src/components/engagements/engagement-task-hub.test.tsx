import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// THE HUB'S THREE CONTRACTS, verified off the browser (the design reference's
// own behaviors): a row with a linked artifact opens the floating panel, the
// checkbox cycles WITHOUT opening it (stopPropagation), and approving a
// document inside the panel moves the task row's meta line behind it.

const updateTaskAction = vi.fn(async () => ({ ok: true }));
const setTaskAssigneeAction = vi.fn(async () => ({ ok: true }));
const approveItemAction = vi.fn(async () => undefined);
const sendReminderAction = vi.fn(async () => ({ ok: true }));
const refresh = vi.fn();

vi.mock("@/app/actions/engagement-tasks", () => ({
  updateTaskAction: (...a: unknown[]) => updateTaskAction(...(a as [])),
  setTaskAssigneeAction: (...a: unknown[]) =>
    setTaskAssigneeAction(...(a as [])),
}));
vi.mock("@/app/actions/items", () => ({
  approveItemAction: (...a: unknown[]) => approveItemAction(...(a as [])),
}));
vi.mock("@/app/actions/engagements", () => ({
  sendReminderAction: (...a: unknown[]) => sendReminderAction(...(a as [])),
}));
vi.mock("@/app/actions/final-documents", () => ({
  deleteFinalDocumentAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/files", () => ({
  getFiledCopyInfoAction: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/i18n/navigation", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ href, children, ...p }: any) => (
    <a href={String(href)} {...p}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { EngagementTaskHub } from "./engagement-task-hub";

const MEMBERS = [
  { id: "u-1", name: "Marie Tremblay" },
  { id: "u-2", name: "Zach" },
];

function makeTasks() {
  return [
    {
      id: "t-plain",
      title: "Prepare T2 return",
      kind: "tax_return",
      status: "todo" as const,
      dueDate: null,
      assigneeIds: ["u-1"],
      notes: "GIFI import",
      subDone: 2,
      subTotal: 3,
      panel: null,
    },
    {
      id: "t-docs",
      title: "Collect year-end documents",
      kind: "document_collection",
      status: "doing" as const,
      dueDate: null,
      assigneeIds: [],
      notes: null,
      subDone: 0,
      subTotal: 0,
      panel: "docs" as const,
    },
  ];
}

const ITEMS = [
  {
    id: "i-1",
    label: "Bank statements",
    status: "submitted" as const,
    files: [{ id: "f-1", name: "rbc.pdf" }],
    rejectionReason: null,
    setAssessment: null,
  },
  {
    id: "i-2",
    label: "T5 slips",
    status: "approved" as const,
    files: [{ id: "f-2", name: "t5.pdf" }],
    rejectionReason: null,
    setAssessment: null,
  },
  {
    id: "i-3",
    label: "Payroll summary",
    status: "pending" as const,
    files: [],
    rejectionReason: null,
    setAssessment: null,
  },
  {
    id: "i-4",
    label: "Notice of assessment",
    status: "rejected" as const,
    files: [{ id: "f-4", name: "noa.pdf" }],
    rejectionReason: "The document is missing page 2 of 2.",
    setAssessment: null,
  },
];

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementTaskHub
        engagementId="e-1"
        tasks={makeTasks()}
        items={ITEMS}
        signatures={[]}
        deliverables={[]}
        deliverablesLocked={false}
        invoiceNumber={null}
        clientName="Nordique Café Inc."
        portalUrl="/r/tok"
        reminderEveryDays={7}
        members={MEMBERS}
        canEdit
        locale="en"
        addTask={null}
        addDeliverable={null}
        preview={null}
        addItem={null}
        addSignature={null}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  updateTaskAction.mockClear();
  approveItemAction.mockClear();
  refresh.mockClear();
});
afterEach(cleanup);

describe("EngagementTaskHub", () => {
  it("shows the live doc meta and opens the floating panel from the artifact row", async () => {
    mount();
    // 1 of 3 approved · 1 to review — computed from the item states.
    expect(screen.getByText("1 of 4 approved · 1 to review")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("Collect year-end documents"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Bank statements");
    expect(dialog.textContent).toContain("Waiting on client");
    // The uploaded file chip links through the authenticated proxy.
    const chip = screen.getByText("rbc.pdf").closest("a");
    expect(chip?.getAttribute("href")).toBe("/api/files/f-1");
    // The AI's send-back reason is visible on the rejected row.
    expect(
      screen.getByText("The document is missing page 2 of 2."),
    ).toBeTruthy();
    expect(screen.getByText("Changes requested")).toBeTruthy();
  });

  it("cycles the checkbox without opening the panel (stopPropagation)", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark Collect year-end documents done",
      }),
    );
    await waitFor(() =>
      expect(updateTaskAction).toHaveBeenCalledWith({
        taskId: "t-docs",
        engagementId: "e-1",
        status: "done",
        statusId: null,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("plain rows have no door", () => {
    mount();
    fireEvent.click(screen.getByText("Prepare T2 return"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("approving in the panel updates the task row's meta line behind it", async () => {
    mount();
    fireEvent.click(screen.getByText("Collect year-end documents"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(approveItemAction).toHaveBeenCalled());
    // Both the panel progress AND the row meta read the same optimistic map.
    expect(screen.getAllByText("2 of 4 approved").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 of 4 approved · 1 to review")).toBeNull();
  });
});
