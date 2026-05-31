import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { Breadcrumb } from "./breadcrumb";

// Stub the locale-aware <Link> (needs next/navigation, absent under vitest)
// with a plain anchor so we can assert the href each crumb produces — locale
// prefixing is next-intl's concern, not this component's.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("Breadcrumb", () => {
  it("renders a labelled nav, links every crumb except the current page", () => {
    render(
      <Breadcrumb
        label="Breadcrumb"
        items={[
          { label: "Engagements", href: "/engagements" },
          { label: "Active", href: "/engagements" },
          { label: "Year-End 2025" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    // The non-final crumbs are links pointing back up the hierarchy.
    expect(within(nav).getByRole("link", { name: "Engagements" })).toHaveAttribute(
      "href",
      "/engagements",
    );
    expect(
      within(nav).getByRole("link", { name: "Active" }),
    ).toBeInTheDocument();
    // The final crumb is the current page: not a link, marked aria-current.
    expect(
      within(nav).queryByRole("link", { name: "Year-End 2025" }),
    ).toBeNull();
    expect(screen.getByText("Year-End 2025")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders one chevron separator fewer than the number of crumbs", () => {
    const { container } = render(
      <Breadcrumb
        items={[
          { label: "Clients", href: "/clients" },
          { label: "Jean Tremblay" },
        ]}
      />,
    );
    // 2 crumbs → exactly 1 separator (the only svg in a shallow trail).
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("truncates the current (last) segment so long titles don't overflow", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Templates", href: "/templates" },
          { label: "A very very long template name that should be clipped" },
        ]}
      />,
    );
    const current = screen.getByText(/A very very long template name/);
    expect(current.className).toContain("truncate");
  });

  it("collapses interior crumbs behind an ellipsis on mobile for deep trails", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Clients", href: "/clients" },
          { label: "Jean Tremblay", href: "/clients/1" },
          { label: "Engagements", href: "/clients/1/engagements" },
          { label: "Year-End 2025" },
        ]}
      />,
    );
    // A mobile-only ellipsis placeholder is rendered...
    expect(screen.getByText("…")).toBeInTheDocument();
    // ...and an interior crumb carries the mobile-hide class on its <li>.
    const interior = screen.getByRole("link", { name: "Jean Tremblay" });
    expect(interior.closest("li")?.className).toContain("hidden");
  });

  it("renders nothing when given no items", () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
