import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import type { Client } from "@/lib/db/clients";

// Capture router.refresh — the dialog calls it after a successful save.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

// The dialog dispatches these through useActionState; capture the calls so
// we can assert whether (and when) a save actually went through. Both
// resolve "ok" so the success path runs.
const updateClientAction = vi.fn(async (_prev: unknown, _data: FormData) => ({
  ok: true,
}));
const createClientAction = vi.fn(async (_prev: unknown, _data: FormData) => ({
  ok: true,
}));
vi.mock("@/app/actions/clients", () => ({
  updateClientAction: (prev: unknown, data: FormData) =>
    updateClientAction(prev, data),
  createClientAction: (prev: unknown, data: FormData) =>
    createClientAction(prev, data),
}));

import { ClientFormDialog } from "./client-form-dialog";

beforeAll(() => {
  // happy-dom implements neither; the dialog (via Radix + our guard) uses
  // both. Plain assignments survive vi.restoreAllMocks (it only undoes spies).
  Element.prototype.scrollIntoView = () => {};
  HTMLFormElement.prototype.reportValidity = () => true;
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  updateClientAction.mockReset();
  createClientAction.mockReset();
  vi.restoreAllMocks();
});

const CLIENT: Client = {
  id: "c1",
  firm_id: "f1",
  type: "individual",
  display_name: "Jean Tremblay",
  email: "old@example.com",
  phone: null,
  locale: "fr",
  external_ref: null,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  archived_at: null,
  assigned_user_id: null,
};

function openEditor(client: Client = CLIENT) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ClientFormDialog mode="edit" locale="en" client={client} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en.Clients.edit_client }));
}

function editForm(): HTMLFormElement {
  const form = screen.getByLabelText(en.Clients.field_email).closest("form");
  if (!form) throw new Error("edit form not found");
  return form;
}

describe("ClientFormDialog email-change guard", () => {
  it("saves directly when the email is unchanged", async () => {
    openEditor();
    fireEvent.submit(editForm());
    await waitFor(() => expect(updateClientAction).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(en.Clients.email_confirm_title),
    ).not.toBeInTheDocument();
  });

  it("holds the save behind a confirmation when the email changes", async () => {
    openEditor();
    fireEvent.change(screen.getByLabelText(en.Clients.field_email), {
      target: { value: "new@example.com" },
    });
    fireEvent.submit(editForm());

    // The confirmation appears and the save has NOT been dispatched yet.
    expect(
      await screen.findByText(en.Clients.email_confirm_title),
    ).toBeInTheDocument();
    expect(updateClientAction).not.toHaveBeenCalled();

    // Confirming dispatches the save exactly once.
    fireEvent.click(
      screen.getByRole("button", { name: en.Clients.email_confirm_confirm }),
    );
    await waitFor(() => expect(updateClientAction).toHaveBeenCalledTimes(1));
  });

  it("does not save when the email-change confirmation is cancelled", async () => {
    openEditor();
    fireEvent.change(screen.getByLabelText(en.Clients.field_email), {
      target: { value: "new@example.com" },
    });
    fireEvent.submit(editForm());

    const confirmDialog = await screen.findByRole("dialog", {
      name: en.Clients.email_confirm_title,
    });
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: en.Common.cancel }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText(en.Clients.email_confirm_title),
      ).not.toBeInTheDocument(),
    );
    expect(updateClientAction).not.toHaveBeenCalled();
  });
});
