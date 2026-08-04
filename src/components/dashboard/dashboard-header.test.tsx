import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DashboardHeader } from "./dashboard-header";
import en from "../../../messages/en.json";

// next-intl's locale-aware <Link> pulls in next/navigation, which has no
// runtime under vitest. Stub it with a plain anchor so we can assert the
// href the component produces — locale prefixing is next-intl's concern,
// not this component's.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderHeader(props: { firstName: string | null; subtitle: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DashboardHeader {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DashboardHeader", () => {
  it("greets the user by first name and shows the firm name WITHOUT a date or action buttons", () => {
    renderHeader({ firstName: "Zach", subtitle: "Acme Co" });

    // The greeting is time-aware (the exact word depends on the clock), so we
    // just assert the heading carries the first name.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent ?? "").toMatch(/Zach/);

    // The subtitle is the firm name ONLY (design 2a): the date moved into the
    // agenda card, where "what day is it" sits beside "what is my day". A
    // subtitle reading "Acme Co · <anything>" is the old design leaking back.
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.queryByText(/Acme Co ·/)).not.toBeInTheDocument();

    // "New engagement" is NOT here any more: the icon rail's "+" is the single
    // primary entry point, and having both was two buttons for one action.
    expect(
      screen.queryByRole("link", { name: en.Engagements.new }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("link")
        .some((a) => a.getAttribute("href") === "/engagements/new"),
    ).toBe(false);

    // "Import clients" left too (founder's call, 2026-08-03): importing is a
    // clients-section job, not a standing button on the Overview. Only the
    // bell (passed in via the `bell` slot) shares the header now.
    expect(
      screen.queryByRole("link", { name: en.Clients.import_title }),
    ).not.toBeInTheDocument();
  });

  it("still renders a greeting + the firm name when the user has no name", () => {
    renderHeader({ firstName: null, subtitle: "Acme Co" });

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
  });
});
