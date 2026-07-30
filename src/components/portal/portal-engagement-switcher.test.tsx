import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  PortalEngagementSwitcher,
  switchHref,
} from "./portal-engagement-switcher";
import en from "../../../messages/en.json";

const TOKEN = "t".repeat(43);
const engagements = [
  { id: "e1", title: "T1 Personal 2026", status: "in_progress" },
  { id: "e2", title: "GST/QST 2026", status: "complete" },
];

afterEach(cleanup);

describe("switchHref", () => {
  it("points at the guarded switch route, carrying only French", () => {
    expect(switchHref(TOKEN, "e2", "en")).toBe(`/r/${TOKEN}/to/e2`);
    expect(switchHref(TOKEN, "e2", "fr")).toBe(`/r/${TOKEN}/to/e2?lang=fr`);
  });

  it("never embeds a magic token for the target — only the current one", () => {
    // The href carries the CURRENT token (already in the URL) + a target *id*,
    // never the sibling's secret token.
    expect(switchHref(TOKEN, "e2", "en")).not.toMatch(/to\/[0-9A-Za-z]{43}/);
  });
});

describe("PortalEngagementSwitcher", () => {
  it("shows the current engagement's title on the trigger", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PortalEngagementSwitcher
          token={TOKEN}
          currentId="e1"
          engagements={engagements}
          locale="en"
        />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveTextContent("T1 Personal 2026");
    // The icon-only affordance carries an accessible name.
    expect(trigger).toHaveTextContent(en.Portal.switch_engagement);
  });
});
