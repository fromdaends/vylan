import { describe, it, expect } from "vitest";
import { CLIENT_TABS, parseClientTab, clientTabHref } from "./tabs";

describe("parseClientTab", () => {
  it("accepts every real tab", () => {
    for (const tab of CLIENT_TABS) expect(parseClientTab(tab)).toBe(tab);
  });

  it("falls back to the overview instead of erroring", () => {
    // A hand-edited URL or an old bookmark should show the client, not a 404.
    for (const junk of [undefined, null, "", "  ", "billing", "OVERVIEW", "../"]) {
      expect(parseClientTab(junk)).toBe("overview");
    }
  });
});

describe("clientTabHref", () => {
  it("leaves the overview as the bare client URL", () => {
    // A link to a client is a link to their overview — no query string.
    expect(clientTabHref("c1", "overview")).toBe("/clients/c1");
  });

  it("puts every other tab in the query string", () => {
    expect(clientTabHref("c1", "engagements")).toBe("/clients/c1?tab=engagements");
    expect(clientTabHref("c1", "organizers")).toBe("/clients/c1?tab=organizers");
    expect(clientTabHref("c1", "bookkeeping")).toBe("/clients/c1?tab=bookkeeping");
  });

  it("round-trips: every href parses back to the tab that made it", () => {
    for (const tab of CLIENT_TABS) {
      const href = clientTabHref("c1", tab);
      const query = href.split("?tab=")[1];
      expect(parseClientTab(query)).toBe(tab);
    }
  });
});
