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

// The dialog POSTs to a stable API route. Capture the fetch so we can assert
// what was sent and simulate the server's JSON response.
const ok = () => ({ json: async () => ({ ok: true, id: "i1" }) });
const fetchMock = vi.fn();
fetchMock.mockResolvedValue(ok());
vi.stubGlobal("fetch", fetchMock);

import { AddItemDialog } from "./add-item-dialog";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  HTMLFormElement.prototype.reportValidity = () => true;
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
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
  it("POSTs to the stable engagement-items route with the label", async () => {
    openDialog();
    fireEvent.change(screen.getByLabelText(en.Engagements.label_placeholder), {
      target: { value: "Bank statement" },
    });
    fireEvent.submit(form());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/engagements/e1/items");
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    expect(fd.get("label")).toBe("Bank statement");
    expect(fd.get("required")).toBeNull(); // unchecked
  });

  it("captures an autofilled label that bypasses React onChange (the Safari bug)", async () => {
    openDialog();
    const label = screen.getByLabelText(
      en.Engagements.label_placeholder,
    ) as HTMLInputElement;
    // Safari autofill: value set with NO change event. Reading the form must
    // still pick it up.
    label.value = "Bank statement";
    fireEvent.submit(form());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const fd = fetchMock.mock.calls[0][1].body as FormData;
    expect(fd.get("label")).toBe("Bank statement");
  });

  it("blocks before fetching when the label is empty", async () => {
    openDialog();
    fireEvent.submit(form());
    expect(
      await screen.findByText(en.Engagements.add_item_check_field),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's raw detail when the add fails", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ error: "add_failed", detail: "boom from server" }),
    });
    openDialog();
    fireEvent.change(screen.getByLabelText(en.Engagements.label_placeholder), {
      target: { value: "T4" },
    });
    fireEvent.submit(form());
    expect(await screen.findByText("boom from server")).toBeInTheDocument();
  });
});
