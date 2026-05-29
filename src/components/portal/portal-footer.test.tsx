import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PortalFooter } from "./portal-footer";
import en from "../../../messages/en.json";

function renderFooter(props: {
  email: string | null;
  subject: string;
  body: string;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PortalFooter {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PortalFooter", () => {
  it("shows the accountant address as visible text and a mailto with recipient + subject + body", () => {
    renderFooter({
      email: "alex@cabinet.ca",
      subject: "Cabinet — Tax 2025",
      body: "Hi,\n\nA question.\n\nThanks.",
    });

    // The address must be visible (so webmail / no-mail-client users can read it).
    const link = screen.getByRole("link", { name: "alex@cabinet.ca" });
    const href = link.getAttribute("href") ?? "";

    // The regression we're fixing: the mailto must carry the recipient.
    expect(href).toContain("mailto:alex@cabinet.ca");
    expect(href).toContain(`subject=${encodeURIComponent("Cabinet — Tax 2025")}`);
    expect(href).toContain(`body=${encodeURIComponent("Hi,\n\nA question.\n\nThanks.")}`);

    // And a copy affordance exists for clients whose browser ignores mailto:.
    expect(screen.getByRole("button", { name: en.Portal.help_copy })).toBeInTheDocument();
  });

  it("falls back to a plain instruction (no mailto link) when no email is on file", () => {
    renderFooter({ email: null, subject: "x", body: "y" });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(en.Portal.help_no_email)).toBeInTheDocument();
  });
});
