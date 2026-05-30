import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// SidebarSearch pulls in the command palette (for the shared event name),
// which imports the locale router. Stub it so the real next/navigation
// (unresolvable under vitest) never loads.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { SidebarSearch } from "./sidebar-search";
import { COMMAND_PALETTE_EVENT } from "./command-palette";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSearch() {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarSearch />
    </NextIntlClientProvider>,
  );
  return within(container);
}

describe("SidebarSearch", () => {
  it("renders as a button showing the search placeholder and label", () => {
    const q = renderSearch();
    const btn = q.getByRole("button", { name: en.Home.search_label });
    expect(btn).toBeInTheDocument();
    expect(
      within(btn).getByText(en.Home.search_placeholder),
    ).toBeInTheDocument();
  });

  it("dispatches the command-palette open event when clicked", () => {
    const onOpen = vi.fn();
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpen);
    try {
      const q = renderSearch();
      fireEvent.click(q.getByRole("button", { name: en.Home.search_label }));
      expect(onOpen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen);
    }
  });

  it("advertises the Cmd/Ctrl-K shortcut for assistive tech", () => {
    const q = renderSearch();
    const btn = q.getByRole("button", { name: en.Home.search_label });
    expect(btn).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
  });
});
