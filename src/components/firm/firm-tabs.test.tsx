// The firm page's tab row.
//
// The rule these tests protect is the founder's, and it is the whole reason
// Roles moved here: A PLACE YOU LOOK AT IS A TAB; A THING YOU DO IS IN THE
// DROPDOWN; NOTHING APPEARS IN BOTH.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirmTabs } from "./firm-tabs";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LABELS = { people: "Members", roles: "Roles", settings: "Settings" };

function hrefFor(label: string): string | null {
  return screen.getByRole("link", { name: label }).getAttribute("href");
}

describe("FirmTabs", () => {
  it("offers Members, Roles and Settings, all on this page", () => {
    render(<FirmTabs current="people" labels={LABELS} />);
    // Every tab is a view of THIS page — a tab row whose items navigate away
    // is a link list wearing a tab row's clothes.
    expect(hrefFor("Members")).toBe("/settings/team");
    expect(hrefFor("Roles")).toBe("/settings/team?tab=roles");
    expect(hrefFor("Settings")).toBe("/settings/team?tab=settings");
  });

  it("keeps Roles between Members and Settings", () => {
    render(<FirmTabs current="roles" labels={LABELS} />);
    const order = screen.getAllByRole("link").map((a) => a.textContent);
    expect(order).toEqual(["Members", "Roles", "Settings"]);
  });

  it("marks the current tab, and only it", () => {
    render(<FirmTabs current="roles" labels={LABELS} />);
    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Roles"]);
  });

  it("HIDES Roles when the firm has no team", () => {
    // Not merely inert — hidden. The page refuses the roles view for a solo
    // firm (nobody to wear a role), so a visible tab would bounce you back to
    // Members and read as a broken link.
    render(<FirmTabs current="people" labels={LABELS} teamEnabled={false} />);
    expect(screen.queryByRole("link", { name: "Roles" })).toBeNull();
    expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("defaults to showing Roles, so an un-updated caller is not silently cut", () => {
    render(<FirmTabs current="people" labels={LABELS} />);
    expect(screen.getByRole("link", { name: "Roles" })).toBeInTheDocument();
  });
});
