import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const addItemAction = vi.fn(async (_prev: unknown, _data: FormData) => ({
  ok: true as const,
}));
vi.mock("@/app/actions/items", () => ({
  addItemAction: (prev: unknown, data: FormData) => addItemAction(prev, data),
}));

import { AddItemDialog } from "./add-item-dialog";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  HTMLFormElement.prototype.reportValidity = () => true;
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  addItemAction.mockReset();
  vi.restoreAllMocks();
});

function openDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AddItemDialog engagementId="e1" />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en.Engagements.add_item }));
}

function form(): HTMLFormElement {
  const f = screen
    .getByLabelText(en.Engagements.label_placeholder)
    .closest("form");
  if (!f) throw new Error("add-item form not found (dialog did not open?)");
  return f;
}

describe("AddItemDialog", () => {
  it("adds an item from a single label (Required left unchecked)", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText(en.Engagements.label_placeholder), {
      target: { value: "Bank statement" },
    });
    // Submit WITHOUT touching the Required checkbox — the reported bug.
    fireEvent.submit(form());

    await waitFor(() => expect(addItemAction).toHaveBeenCalledTimes(1));
    const fd = addItemAction.mock.calls[0][1] as FormData;
    expect(fd.get("label")).toBe("Bank statement");
    // Bridge: the same value is sent under the legacy names too, so the add
    // works whether the server runs the new or old action (deploy skew).
    expect(fd.get("label_fr")).toBe("Bank statement");
    expect(fd.get("label_en")).toBe("Bank statement");
    expect(fd.get("required")).toBeNull(); // unchecked
    expect(
      screen.queryByText(en.Engagements.add_item_check_field),
    ).not.toBeInTheDocument();
  });

  it("captures an autofilled label that bypasses React onChange (the Safari bug)", async () => {
    openDialog();
    const label = screen.getByLabelText(
      en.Engagements.label_placeholder,
    ) as HTMLInputElement;
    // Simulate Safari autofill: set the DOM value directly with NO change event.
    // A controlled mirror would read empty here; reading the form must not.
    label.value = "Bank statement";
    fireEvent.submit(form());

    await waitFor(() => expect(addItemAction).toHaveBeenCalledTimes(1));
    const fd = addItemAction.mock.calls[0][1] as FormData;
    expect(fd.get("label")).toBe("Bank statement");
  });

  it("blocks and warns when the label is empty", async () => {
    openDialog();
    fireEvent.submit(form());
    expect(
      await screen.findByText(en.Engagements.add_item_check_field),
    ).toBeInTheDocument();
    expect(addItemAction).not.toHaveBeenCalled();
  });
});
