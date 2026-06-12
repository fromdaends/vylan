import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";

// next-intl's locale-aware <Link> pulls in next/navigation, which has no
// runtime under vitest. Stub it with a plain anchor so we can assert hrefs.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { WhatsNewBell } from "./whats-new-bell";

afterEach(cleanup);

function renderBell(count: number, children: ReactNode = <p>feed rows</p>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WhatsNewBell count={count}>{children}</WhatsNewBell>
    </NextIntlClientProvider>,
  );
}

describe("WhatsNewBell", () => {
  it("shows the count badge and opens the slide-out with the feed + View all", () => {
    renderBell(12);

    // Trigger carries an accessible label with the count; the visual badge
    // shows the same number.
    const trigger = screen.getByRole("button", {
      name: "What's new: 12 recent updates",
    });
    expect(trigger.textContent).toContain("12");

    fireEvent.click(trigger);

    // Panel open: title, the server-rendered rows, and View all → the full
    // notifications page.
    expect(screen.getByText(en.Home.whats_new)).toBeInTheDocument();
    expect(screen.getByText("feed rows")).toBeInTheDocument();
    const viewAll = screen.getByRole("link", {
      name: new RegExp(en.Home.view_all),
    });
    expect(viewAll.getAttribute("href") ?? "").toContain("/notifications");
  });

  it("hides the badge and View all when there is nothing new", () => {
    renderBell(0, <p>empty state</p>);

    const trigger = screen.getByRole("button", {
      name: /no recent updates/i,
    });
    // No "0" badge — the bell stays quiet when there's nothing to report.
    expect(trigger.textContent).not.toContain("0");

    fireEvent.click(trigger);
    expect(screen.getByText("empty state")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: new RegExp(en.Home.view_all) }),
    ).toBeNull();
  });

  it("closes the panel when a link inside it is clicked (row navigation)", () => {
    renderBell(1, <a href="#row">row link</a>);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("row link")).toBeInTheDocument();

    fireEvent.click(screen.getByText("row link"));
    // The sheet unmounts its content on close.
    expect(screen.queryByText("row link")).toBeNull();
  });
});
