import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { TemplatesGallery, type TemplateCard } from "./templates-gallery";
import en from "../../../messages/en.json";

// Stub the locale-aware <Link> (needs next/navigation, absent under vitest)
// with a plain anchor so we can assert the href each card produces.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const templates: TemplateCard[] = [
  { id: "b1", name: "T1 Personal Return", type: "t1", itemCount: 8, builtIn: true },
  { id: "b2", name: "Corporate T2", type: "t2", itemCount: 12, builtIn: true },
  {
    id: "f1",
    name: "Monthly Bookkeeping",
    type: "bookkeeping",
    itemCount: 5,
    builtIn: false,
  },
  {
    id: "f2",
    name: "Client Onboarding",
    type: "custom",
    itemCount: 3,
    builtIn: false,
  },
];

function renderGallery(items: TemplateCard[] = templates) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TemplatesGallery templates={items} />
    </NextIntlClientProvider>,
  );
}

const blankName = new RegExp(en.Dashboard.tmpl_blank_name, "i");

describe("TemplatesGallery", () => {
  it("defaults to Recommended: a blank starter plus the built-in templates", () => {
    renderGallery();

    // Blank card → the from-scratch flow (no template query).
    const blank = screen.getByRole("link", { name: blankName });
    expect(blank).toHaveAttribute("href", "/engagements/new");

    // A built-in card carries its template id into the new-engagement flow.
    const t1 = screen.getByRole("link", { name: /T1 Personal Return/i });
    expect(t1.getAttribute("href")).toContain("/engagements/new?template=b1");

    // Firm (non-built-in) templates are hidden under Recommended.
    expect(
      screen.queryByRole("link", { name: /Client Onboarding/i }),
    ).not.toBeInTheDocument();
  });

  it("filters to firm custom templates when the Custom tab is selected", () => {
    renderGallery();
    fireEvent.click(
      screen.getByRole("tab", { name: en.Dashboard.tmpl_cat_custom }),
    );

    expect(
      screen.getByRole("link", { name: /Client Onboarding/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /T1 Personal Return/i }),
    ).not.toBeInTheDocument();
    // The blank starter only appears under Recommended.
    expect(
      screen.queryByRole("link", { name: blankName }),
    ).not.toBeInTheDocument();
  });

  it("filters to T1 templates regardless of origin when the T1 tab is selected", () => {
    renderGallery();
    fireEvent.click(screen.getByRole("tab", { name: "T1" }));

    expect(
      screen.getByRole("link", { name: /T1 Personal Return/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Corporate T2/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when the search matches nothing", () => {
    renderGallery();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzzzz" },
    });

    expect(screen.getByText(en.Dashboard.tmpl_empty)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /T1 Personal Return/i }),
    ).not.toBeInTheDocument();
  });
});
