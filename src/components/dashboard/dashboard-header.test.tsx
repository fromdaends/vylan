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

function renderHeader(props: {
  firstName: string | null;
  attentionCount: number;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DashboardHeader {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DashboardHeader", () => {
  it("greets the user by first name and links to the two primary actions", () => {
    renderHeader({ firstName: "Zach", attentionCount: 3 });

    // Personalized greeting in the heading.
    expect(
      screen.getByRole("heading", { name: "Welcome, Zach!" }),
    ).toBeInTheDocument();

    // Attention status reflects the count (plural branch).
    expect(
      screen.getByText(/3 engagements that need your attention/i),
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

  it("uses the singular status when exactly one engagement needs attention", () => {
    renderHeader({ firstName: "Zach", attentionCount: 1 });
    expect(
      screen.getByText(/1 engagement that needs your attention/i),
    ).toBeInTheDocument();
  });

  it("falls back to a friendly greeting and an all-clear line when unnamed and nothing is pending", () => {
    renderHeader({ firstName: null, attentionCount: 0 });

    expect(
      screen.getByRole("heading", { name: "Welcome, there!" }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.Dashboard.all_clear)).toBeInTheDocument();
  });
});
