import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  screen,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// Capture router.push; the palette routes there on selection.
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette, COMMAND_PALETTE_EVENT } from "./command-palette";

// Radix Dialog + cmdk call scrollIntoView, which happy-dom doesn't implement.
// A plain assignment survives vi.restoreAllMocks (it only restores spies).
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  push.mockReset();
  localStorage.clear();
  vi.restoreAllMocks();
});

type ClientHit = { id: string; display_name: string; email: string | null };
type EngagementHit = {
  id: string;
  title: string;
  client_id: string;
  client_display_name: string | null;
};

function mockSearch(payload: {
  clients: ClientHit[];
  engagements: EngagementHit[];
}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

function renderPalette() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CommandPalette />
    </NextIntlClientProvider>,
  );
}

function open() {
  act(() => {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
  });
}

function input() {
  return screen.getByPlaceholderText(en.CommandPalette.placeholder);
}

describe("CommandPalette", () => {
  it("opens on the global event and shows the quick-nav destinations", () => {
    renderPalette();
    open();
    expect(
      screen.getByPlaceholderText(en.CommandPalette.placeholder),
    ).toBeInTheDocument();
    expect(screen.getByText(en.CommandPalette.jump_to)).toBeInTheDocument();
    // Nav rows are rendered when no query is typed.
    expect(
      screen.getByRole("option", { name: en.App.nav_dashboard }),
    ).toBeInTheDocument();
  });

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
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "bou" } });

    expect(
      await screen.findByRole("option", { name: /T1 2025/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /a@b\.com/i }),
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
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "bou" } });
    const opt = await screen.findByRole("option", { name: /Bouchard Inc/i });
    fireEvent.click(opt);
    expect(push).toHaveBeenCalledWith("/clients/c1");
  });

  it("shows a no-results state once the search comes back empty", async () => {
    mockSearch({ clients: [], engagements: [] });
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "zzz" } });
    expect(
      await screen.findByText(en.CommandPalette.no_results),
    ).toBeInTheDocument();
  });

  it("remembers a chosen client under 'recently visited' on the next open", async () => {
    mockSearch({
      clients: [{ id: "c1", display_name: "Bouchard Inc", email: null }],
      engagements: [],
    });
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "bou" } });
    fireEvent.click(await screen.findByRole("option", { name: /Bouchard Inc/i }));

    // Reopen — the client should now appear under "recently visited".
    open();
    expect(
      screen.getByText(en.CommandPalette.recently_visited),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Bouchard Inc/i }),
    ).toBeInTheDocument();
  });

  it("matches static pages and settings from the catalog (e.g. 'timezone')", async () => {
    mockSearch({ clients: [], engagements: [] });
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "timezone" } });
    // The catalog match is client-side (no API needed) and lands under "Go to".
    expect(
      await screen.findByText(en.CommandPalette.group_go),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: new RegExp(en.Settings.section_timezone, "i") }),
    ).toBeInTheDocument();
  });

  it("finds the two-factor setting by the abbreviation '2fa'", async () => {
    mockSearch({ clients: [], engagements: [] });
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "2fa" } });
    fireEvent.click(
      await screen.findByRole("option", {
        name: new RegExp(en.Profile.mfa_title, "i"),
      }),
    );
    expect(push).toHaveBeenCalledWith("/settings?tab=security");
  });

  it("lists matching templates and routes to a custom one", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clients: [],
        engagements: [],
        templates: [{ id: "tpl1", name: "T1 Personnel", is_builtin: false }],
      }),
    }) as unknown as typeof fetch;
    renderPalette();
    open();
    fireEvent.change(input(), { target: { value: "personnel" } });
    fireEvent.click(
      await screen.findByRole("option", { name: /T1 Personnel/i }),
    );
    expect(push).toHaveBeenCalledWith("/templates/tpl1");
  });
});
