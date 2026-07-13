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
import { QuickbooksEditableField } from "./quickbooks-editable-field";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

beforeAll(() => {
  // happy-dom implements none of these; Radix Popover + cmdk touch them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.restoreAllMocks();
});

const base = {
  fileId: "f1",
  field: "party" as const,
  label: "Vendor",
  options: [
    { id: "v1", name: "Home Depot" },
    { id: "v2", name: "Staples" },
  ],
  choosePrompt: "Pick a vendor",
};

function renderField(props: Partial<React.ComponentProps<typeof QuickbooksEditableField>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <QuickbooksEditableField initial={null} {...base} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("QuickbooksEditableField — AI hints", () => {
  it("shows the raw document text under an UNCHOSEN (amber) cell", () => {
    renderField({ initial: null, sourceHint: "Northline Office & Print" });
    expect(screen.getByText(en.Quickbooks.pick_source_label)).toBeTruthy();
    expect(screen.getByText("Northline Office & Print")).toBeTruthy();
  });

  it("hides the document text once a value is chosen", () => {
    renderField({
      initial: { id: "v1", name: "Home Depot" },
      sourceHint: "Northline Office & Print",
    });
    expect(screen.queryByText("Northline Office & Print")).toBeNull();
  });

  it("does not render the hint row when there is no source text", () => {
    renderField({ initial: null, sourceHint: null });
    expect(screen.queryByText(en.Quickbooks.pick_source_label)).toBeNull();
  });

  it("surfaces the AI's ranked guesses in a Suggested group and saves the pick", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderField({
      initial: null,
      suggested: [{ id: "v9", name: "Northline Office" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick a vendor" }));

    await waitFor(() =>
      expect(screen.getByText(en.Quickbooks.pick_suggested)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Northline Office"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/quickbooks/suggestions/f1/resolve");
    expect(JSON.parse(opts.body as string)).toEqual({
      party: { id: "v9", name: "Northline Office" },
    });
  });

  it("shows a suggested entity once — pulled out of the full list", async () => {
    renderField({
      initial: null,
      options: [
        { id: "v1", name: "Home Depot" },
        { id: "v2", name: "Staples" },
      ],
      suggested: [{ id: "v1", name: "Home Depot" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick a vendor" }));
    await waitFor(() =>
      expect(screen.getByText(en.Quickbooks.pick_suggested)).toBeTruthy(),
    );
    // "Home Depot" is suggested, so it renders exactly once (in Suggested), never
    // duplicated in the full list below.
    expect(screen.getAllByText("Home Depot").length).toBe(1);
    // A non-suggested option still appears in the full list.
    expect(screen.getByText("Staples")).toBeTruthy();
  });

  it("offers + Create for a typed name that isn't in the list, and saves the new entity", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/quickbooks/entities")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            entity: { id: "V99", name: "Northline Office" },
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) }; // resolve
    });
    vi.stubGlobal("fetch", fetchMock);

    renderField({ initial: null, createKind: "vendor" });
    fireEvent.click(screen.getByRole("button", { name: "Pick a vendor" }));
    fireEvent.change(
      screen.getByPlaceholderText(en.Quickbooks.pick_search),
      { target: { value: "Northline Office" } },
    );

    const createBtn = await screen.findByText(/Create "Northline Office"/);
    fireEvent.click(createBtn);

    // First the create call, then the resolve (save) call.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/api/quickbooks/suggestions/f1/resolve"),
        ),
      ).toBe(true),
    );
    const createCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/quickbooks/entities"),
    ) as unknown as [string, RequestInit];
    expect(JSON.parse(createCall[1].body as string)).toEqual({
      kind: "vendor",
      name: "Northline Office",
    });
    const resolveCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/resolve"),
    ) as unknown as [string, RequestInit];
    expect(JSON.parse(resolveCall[1].body as string)).toEqual({
      party: { id: "V99", name: "Northline Office" },
    });
  });

  it("does NOT offer + Create when the field isn't creatable (createKind null)", async () => {
    renderField({ initial: null, createKind: null });
    fireEvent.click(screen.getByRole("button", { name: "Pick a vendor" }));
    fireEvent.change(
      screen.getByPlaceholderText(en.Quickbooks.pick_search),
      { target: { value: "Brand New Vendor" } },
    );
    await waitFor(() =>
      expect(screen.queryByText(/Create "Brand New Vendor"/)).toBeNull(),
    );
  });

  it("does NOT offer + Create when the typed name already exists (case-insensitive)", async () => {
    renderField({
      initial: null,
      createKind: "vendor",
      options: [{ id: "v1", name: "Home Depot" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Pick a vendor" }));
    fireEvent.change(
      screen.getByPlaceholderText(en.Quickbooks.pick_search),
      { target: { value: "home depot" } },
    );
    await waitFor(() =>
      expect(screen.queryByText(/Create "home depot"/)).toBeNull(),
    );
  });

  it("omits an already-chosen option from the Suggested group", async () => {
    renderField({
      initial: { id: "v9", name: "Northline Office" },
      suggested: [
        { id: "v9", name: "Northline Office" },
        { id: "v8", name: "Northgate Supply" },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Northline Office" }),
    );

    await waitFor(() =>
      expect(screen.getByText(en.Quickbooks.pick_suggested)).toBeTruthy(),
    );
    // The chosen one is filtered out of Suggested; the other guess remains.
    const suggestedItems = screen.getAllByText("Northgate Supply");
    expect(suggestedItems.length).toBeGreaterThan(0);
  });
});
