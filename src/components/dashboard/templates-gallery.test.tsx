import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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
  {
    id: "b1",
    name: "T1 Personal Return",
    type: "t1",
    itemCount: 8,
    requiredCount: 3,
    preview: ["T4", "RL-1"],
    builtIn: true,
  },
  {
    id: "b2",
    name: "Corporate T2",
    type: "t2",
    itemCount: 12,
    requiredCount: 5,
    preview: ["Trial balance", "General ledger"],
    builtIn: true,
  },
  {
    id: "f1",
    name: "Monthly Bookkeeping",
    type: "bookkeeping",
    itemCount: 5,
    requiredCount: 4,
    preview: ["Bank statements"],
    builtIn: false,
  },
  {
    id: "f2",
    name: "Client Onboarding",
    type: "custom",
    itemCount: 3,
    requiredCount: 2,
    preview: ["Prior return"],
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
  it("shows every template, regardless of type or origin", () => {
    renderGallery();

    // A built-in card carries its template id into the new-engagement flow.
    const t1 = screen.getByRole("link", { name: /T1 Personal Return/i });
    expect(t1.getAttribute("href")).toContain("/engagements/new?template=b1");

    // Every type + both origins appear — there is no category filtering.
    expect(
      screen.getByRole("link", { name: /Corporate T2/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Monthly Bookkeeping/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Client Onboarding/i }),
    ).toBeInTheDocument();
  });

  it("has no blank / 'from scratch' card — only real templates", () => {
    renderGallery();
    // No plain from-scratch link (href exactly /engagements/new, no ?template).
    const links = screen.getAllByRole("link");
    expect(
      links.some((a) => a.getAttribute("href") === "/engagements/new"),
    ).toBe(false);
    expect(screen.queryByText(blankName)).not.toBeInTheDocument();
  });

  it("renders no category tabs and no search box", () => {
    renderGallery();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
