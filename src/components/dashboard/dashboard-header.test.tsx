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
  it("greets the user by first name, shows the subtitle, and links to the two primary actions", () => {
    renderHeader({
      firstName: "Zach",
      subtitle: "Acme Co · Friday, May 29, 2026",
    });

    // The greeting is time-aware (the exact word depends on the clock), so we
    // just assert the heading carries the first name.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent ?? "").toMatch(/Zach/);

    // Firm name · date subtitle.
    expect(
      screen.getByText("Acme Co · Friday, May 29, 2026"),
    ).toBeInTheDocument();

    // New engagement → the engagement creation flow.
    const newEng = screen.getByRole("link", { name: en.Engagements.new });
    expect(newEng.getAttribute("href") ?? "").toContain("/engagements/new");

    // Import clients → the CSV import flow.
    const importClients = screen.getByRole("link", {
      name: en.Clients.import_title,
    });
    expect(importClients.getAttribute("href") ?? "").toContain(
      "/clients/import",
    );
  });

  it("still renders a greeting + subtitle when the user has no name", () => {
    renderHeader({ firstName: null, subtitle: "Acme Co · Friday" });

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Acme Co · Friday")).toBeInTheDocument();
  });
});
