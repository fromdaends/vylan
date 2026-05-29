import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// Capture router.push; the component routes there on selection.
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { SidebarSearch } from "./sidebar-search";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

function mockSearch(payload: {
  clients: { id: string; display_name: string; email: string | null }[];
  engagements: {
    id: string;
    title: string;
    client_id: string;
    client_display_name: string | null;
  }[];
}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

// Scope queries to this render's container (the dropdown is a descendant of
// the component), so a search left mounted by an earlier test can't bleed in.
function renderSearch() {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarSearch />
    </NextIntlClientProvider>,
  );
  return within(container);
}

describe("SidebarSearch", () => {
  it("queries /api/search and lists matching clients and engagements", async () => {
    mockSearch({
      clients: [{ id: "c1", display_name: "Bouchard Inc", email: "a@b.com" }],
      engagements: [
        {
          id: "e1",
          title: "T1 2025",
          client_id: "c1",
          client_display_name: "Bouchard Inc",
        },
      ],
    });
    const q = renderSearch();
    fireEvent.change(q.getByRole("combobox"), { target: { value: "bou" } });

    // Engagement row (unique title) and client row (matched by its unique
    // email subtitle — "Bouchard Inc" also appears as the engagement's
    // client label, so it isn't unique on its own).
    expect(
      await q.findByRole("option", { name: /T1 2025/i }),
    ).toBeInTheDocument();
    expect(
      q.getByRole("option", { name: /a@b\.com/i }),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/search?q=bou"),
      expect.anything(),
    );
  });

  it("routes to the client when its row is chosen", async () => {
    mockSearch({
      clients: [{ id: "c1", display_name: "Bouchard Inc", email: null }],
      engagements: [],
    });
    const q = renderSearch();
    fireEvent.change(q.getByRole("combobox"), { target: { value: "bou" } });
    const opt = await q.findByRole("option", { name: /Bouchard Inc/i });
    // The row commits on mousedown (so the outside-click handler can't close
    // the dropdown first).
    fireEvent.mouseDown(opt);
    expect(push).toHaveBeenCalledWith("/clients/c1");
  });

  it("falls back to the clients page on Enter with nothing highlighted", async () => {
    mockSearch({ clients: [], engagements: [] });
    const q = renderSearch();
    const input = q.getByRole("combobox");
    fireEvent.change(input, { target: { value: "bouchard" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/clients?q=bouchard");
  });

  it("shows a no-results state once the search comes back empty", async () => {
    mockSearch({ clients: [], engagements: [] });
    const q = renderSearch();
    fireEvent.change(q.getByRole("combobox"), { target: { value: "zzz" } });
    expect(await q.findByText(en.Home.search_no_results)).toBeInTheDocument();
  });
});
