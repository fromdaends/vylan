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
  {
    id: "c-mathieu",
    display_name: "Mathieu Lévesque",
    type: "individual" as const,
    email: null,
  },
  {
    id: "c-abc",
    display_name: "ABC Incorporation Inc",
    type: "business" as const,
    email: null,
  },
];

beforeEach(() => {
  addTaskAction.mockClear();
  addTaskAction.mockResolvedValue({ ok: true });
  refresh.mockClear();
});

afterEach(() => cleanup());

function renderDialog(props: React.ComponentProps<typeof AddTaskDialog>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AddTaskDialog {...props} />
    </NextIntlClientProvider>,
  );
}

describe("AddTaskDialog — firm-wide mode", () => {
  // The founder's ask, still unreachable until this shipped: "i want to have a
  // way to create tasks that dont live within an engagement but they would
  // still be tied to a client". The database has allowed it since 1350; there
  // was simply no button.
  it("creates a task against a client with NO engagement", async () => {
    renderDialog({ mode: "firm", clients: CLIENTS });
    fireEvent.click(screen.getByRole("button", { name: /Add task/i }));

    // Pick the client through the shared combobox.
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Mathieu Lévesque"));

    fireEvent.change(
      screen.getByLabelText(en.Engagements.add_task_name as string),
      { target: { value: "  Call about the CRA notice  " } },
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /Add task/i }).at(-1)!,
    );

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith({
      clientId: "c-mathieu",
      // Explicitly null, not omitted — this belongs to the client and to no job.
      engagementId: null,
      title: "Call about the CRA notice",
      // The only kind possible without a job: the other three point at
      // collections keyed by engagement_id.
      kind: "task",
    });
  });

  it("refuses to submit until BOTH a client and a name are given", async () => {
    renderDialog({ mode: "firm", clients: CLIENTS });
    fireEvent.click(screen.getByRole("button", { name: /Add task/i }));

    const submit = () => screen.getAllByRole("button", { name: /Add task/i }).at(-1)!;
    expect(submit()).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText(en.Engagements.add_task_name as string),
      { target: { value: "Call about the CRA notice" } },
    );
    // Named, but nobody to file it against. Guessing a client is how a task
    // ends up on the wrong person's file.
    expect(submit()).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("ABC Incorporation Inc"));
    await waitFor(() => expect(submit()).not.toBeDisabled());
  });

  it("never offers a kind that needs a job", async () => {
    renderDialog({ mode: "firm", clients: CLIENTS });
    fireEvent.click(screen.getByRole("button", { name: /Add task/i }));

    for (const gone of [
      en.Engagements.kind_document_collection as string,
      en.Engagements.kind_signatures as string,
      en.Engagements.kind_deliverables as string,
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });
});

describe("AddTaskDialog — on a job", () => {
  it("still asks which kind first, and hides the ones already there", async () => {
    renderDialog({
      clientId: "c-abc",
      engagementId: "e-1",
      existingKinds: ["document_collection"],
    });
    fireEvent.click(screen.getByRole("button", { name: /Add task/i }));

    // Already has one, and the database allows only one per job.
    expect(
      screen.queryByText(en.Engagements.kind_document_collection as string),
    ).toBeNull();
    expect(
      screen.getByText(en.Engagements.kind_signatures as string),
    ).toBeTruthy();

    fireEvent.click(screen.getByText(en.Engagements.kind_signatures as string));
    fireEvent.click(
      screen.getAllByRole("button", { name: /Add task/i }).at(-1)!,
    );

    await waitFor(() => expect(addTaskAction).toHaveBeenCalledTimes(1));
    expect(addTaskAction).toHaveBeenCalledWith({
      clientId: "c-abc",
      engagementId: "e-1",
      // Pre-filled from the kind, because nobody wants to type "Signatures".
      title: en.Engagements.kind_signatures,
      kind: "signatures",
    });
  });
});
