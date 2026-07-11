import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";

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
  it("shows the count badge and opens the scrollable feed without View all", () => {
    renderBell(12);

    const trigger = screen.getByRole("button", {
      name: "What's new: 12 recent updates",
    });
    expect(trigger.textContent).toContain("12");

    fireEvent.click(trigger);

    expect(screen.getByText(en.Home.whats_new)).toBeInTheDocument();
    expect(screen.getByText("feed rows")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: new RegExp(en.Home.view_all) }),
    ).toBeNull();
  });

  it("hides the badge when there is nothing new", () => {
    renderBell(0, <p>empty state</p>);

    const trigger = screen.getByRole("button", {
      name: /no recent updates/i,
    });
    expect(trigger.textContent).not.toContain("0");

    fireEvent.click(trigger);
    expect(screen.getByText("empty state")).toBeInTheDocument();
  });

  it("closes the panel when a feed row link is clicked", () => {
    renderBell(1, <a href="#row">row link</a>);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("row link")).toBeInTheDocument();

    fireEvent.click(screen.getByText("row link"));
    expect(screen.queryByText("row link")).toBeNull();
  });
});
