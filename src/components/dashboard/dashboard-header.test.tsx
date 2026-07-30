import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DashboardHeader } from "./dashboard-header";
import { formatDate } from "@/lib/format";
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
  it("greets the user by first name, shows firm + LOCAL today's date, and links to Import clients", () => {
    renderHeader({ firstName: "Zach", subtitle: "Acme Co" });

    // The greeting is time-aware (the exact word depends on the clock), so we
    // just assert the heading carries the first name.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent ?? "").toMatch(/Zach/);

    // Firm name · today's date, formatted from THIS machine's clock (the
    // component appends the user-local date itself; the page no longer bakes
    // in the server's UTC "today").
    const localToday = formatDate(new Date(), "en", "long");
    expect(screen.getByText(`Acme Co · ${localToday}`)).toBeInTheDocument();

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

    // Import clients → the CSV import flow.
    const importClients = screen.getByRole("link", {
      name: en.Clients.import_title,
    });
    expect(importClients.getAttribute("href") ?? "").toContain(
      "/clients/import",
    );
  });

  it("still renders a greeting + the local date when the user has no name", () => {
    renderHeader({ firstName: null, subtitle: "Acme Co" });

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    const localToday = formatDate(new Date(), "en", "long");
    expect(screen.getByText(`Acme Co · ${localToday}`)).toBeInTheDocument();
  });
});
