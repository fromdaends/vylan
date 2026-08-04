import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const addTaskAction = vi.fn(async () => ({ ok: true }));
const refresh = vi.fn();

vi.mock("@/app/actions/engagement-tasks", () => ({
  addTaskAction: (...args: unknown[]) => addTaskAction(...(args as [])),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AddTaskDialog } from "./add-task-dialog";

const CLIENTS = [
  { id: "c-mathieu", display_name: "Mathieu Lévesque", type: "individual" as const, email: null },
  { id: "c-abc", display_name: "ABC Incorporation Inc", type: "business" as const, email: null },
];

const ENGAGEMENTS = [
  { id: "e-abc-t2", clientId: "c-abc", title: "T2 Tax Return", existingKinds: ["document_collection"] },
  { id: "e-abc-bk", clientId: "c-abc", title: "Bookkeeping 2026", existingKinds: [] },
  { id: "e-mat-t1", clientId: "c-mathieu", title: "T1 2025", existingKinds: [] },
];

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

beforeEach(() => {
  addTaskAction.mockClear();
  addTaskAction.mockResolvedValue({ ok: true });
  refresh.mockClear();
});
afterEach(() => cleanup());

function renderDialog(props: React.ComponentProps<typeof AddTaskDialog> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AddTaskDialog {...props} />
    </NextIntlClientProvider>,
  );
}

const openIt = () =>
  fireEvent.click(screen.getByRole("button", { name: /Add task/i }));
const submit = () => screen.getAllByRole("button", { name: /Add task/i }).at(-1)!;
const nameField = () =>
  screen.getByLabelText(en.Engagements.add_task_name as string) as HTMLInputElement;

// The founder: "now theres 2 kinds of ways of adding tasks... MERGE THE TWO
// VERSIONS." They were two flows because the CONTEXT decided the questions —
// on a job it asked the kind, on the Tasks page it asked the client and
// skipped the kind entirely. Now the questions are identical everywhere and
// only the pre-filled answers differ, which is what these pin.
describe("AddTaskDialog — the kind question comes first, on BOTH screens", () => {
  it("asks the kind on the firm-wide Tasks page, where it used to be skipped", () => {
    renderDialog({ clients: CLIENTS, engagements: ENGAGEMENTS, members: MEMBERS });
    openIt();
    for (const label of [
      en.Engagements.kind_document_collection,
      en.Engagements.kind_signatures,
      en.Engagements.kind_deliverables,
      en.Engagements.kind_task,
    ] as string[]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("asks it on a job too, greying out the kinds that job already has", () => {
    renderDialog({
      clientId: "c-abc",
      engagementId: "e-abc-t2",
      existingKinds: ["document_collection"],
      members: MEMBERS,
    });
    openIt();
    const row = (l: string) =>
      screen.getByText(l).closest("button") as HTMLButtonElement;
    expect(row(en.Engagements.kind_document_collection as string)).toBeDisabled();
    expect(row(en.Engagements.kind_signatures as string)).not.toBeDisabled();
    expect(screen.getByText(en.Engagements.add_task_kind_taken as string)).toBeTruthy();
  });
});

describe("AddTaskDialog — everything is asked up front", () => {
  // "creating a task should ask for a due date and whatever relevant
  // information. Not only after."
  it("sends the due date and assignees WITH the create, not after it", async () => {
    renderDialog({ clientId: "c-abc", engagementId: "e-abc-t2", members: MEMBERS });
    openIt();
    fireEvent.click(screen.getByText(en.Engagements.kind_task as string));

    fireEvent.change(nameField(), {
      target: { value: "  Call about the CRA notice  " },
    });
    fireEvent.change(screen.getByLabelText(en.Engagements.task_due as string), {
      target: { value: "2026-04-30" },
    });
    fireEvent.click(screen.getByText("Zachary Thresh"));

    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit());

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith({
      clientId: "c-abc",
      engagementId: "e-abc-t2",
      title: "Call about the CRA notice",
      kind: "task",
      dueDate: "2026-04-30",
      priority: "none",
      assigneeIds: ["u-zach"],
    });
  });

  it("still only REQUIRES a name — forcing an owner is how everything lands on its creator", async () => {
    renderDialog({ clientId: "c-abc", engagementId: "e-abc-t2", members: MEMBERS });
    openIt();
    fireEvent.click(screen.getByText(en.Engagements.kind_task as string));
    expect(submit()).toBeDisabled();

    fireEvent.change(nameField(), {
      target: { value: "Reconcile the trial balance" },
    });
    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit());

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: null,
        priority: "none",
        assigneeIds: [],
      }),
    );
  });
});

describe("AddTaskDialog — a collection kind needs a job, so it asks for one", () => {
  it("will not submit a document collection with only a name and a client", async () => {
    renderDialog({ clients: CLIENTS, engagements: ENGAGEMENTS, members: MEMBERS });
    openIt();
    fireEvent.click(
      screen.getByText(en.Engagements.kind_document_collection as string),
    );
    fireEvent.change(nameField(), {
      target: { value: "2025 T2 supporting documents" },
    });
    expect(submit()).toBeDisabled();

    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByText("ABC Incorporation Inc"));
    // Still not enough: a document collection drives one engagement's items,
    // so it cannot exist without being told which.
    expect(submit()).toBeDisabled();
  });

  it("offers only the jobs that can actually TAKE this kind", async () => {
    renderDialog({ clients: CLIENTS, engagements: ENGAGEMENTS, members: MEMBERS });
    openIt();
    fireEvent.click(
      screen.getByText(en.Engagements.kind_document_collection as string),
    );
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByText("ABC Incorporation Inc"));

    // T2 Tax Return already has one and the database refuses a second, so it is
    // off the list. An option that always errors is worse than no option.
    expect(screen.queryByText("T2 Tax Return")).toBeNull();
  });

  it("a PLAIN task needs no job at all — the whole point of the firm-wide list", async () => {
    renderDialog({ clients: CLIENTS, engagements: ENGAGEMENTS, members: MEMBERS });
    openIt();
    fireEvent.click(screen.getByText(en.Engagements.kind_task as string));
    fireEvent.change(nameField(), {
      target: { value: "Call about the CRA notice" },
    });
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByText("Mathieu Lévesque"));

    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit());

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c-mathieu",
        // Explicitly null, not omitted.
        engagementId: null,
        kind: "task",
      }),
    );
  });
});
