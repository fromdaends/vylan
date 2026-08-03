import { describe, it, expect } from "vitest";
import {
  CLIENT_TABS,
  parseClientTab,
  clientTabHref,
  CLIENT_ENGAGEMENT_VIEWS,
  CLIENT_ENGAGEMENT_VIEW_PARAM,
  parseClientEngagementView,
  clientEngagementViewHref,
} from "./tabs";

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

describe("parseClientEngagementView", () => {
  it("accepts every offered view", () => {
    for (const v of CLIENT_ENGAGEMENT_VIEWS) {
      expect(parseClientEngagementView(v)).toBe(v);
    }
  });

  it("falls back to Active — including for views this tab does not offer", () => {
    // 'drafts' and 'deleted' are real /engagements views that the client tab
    // deliberately drops. A link carrying one must land on the working list,
    // not on an empty table with no filter selected.
    for (const junk of [undefined, null, "", "drafts", "deleted", "ACTIVE"]) {
      expect(parseClientEngagementView(junk)).toBe("active");
    }
  });
});

describe("clientEngagementViewHref", () => {
  it("leaves Active as the bare tab URL", () => {
    // Active is the default, so arriving on the tab and clicking Active give
    // the same URL — otherwise the back button walks through a no-op.
    expect(clientEngagementViewHref("c1", "active")).toBe(
      "/clients/c1?tab=engagements",
    );
  });

  it("uses its own param, not one another page already reads", () => {
    // /files reads `tab` and /engagements reads `stage`/`sort`/`dir`; reusing
    // either would hand the other page a value that means something else.
    const href = clientEngagementViewHref("c1", "archived");
    expect(href).toBe(`/clients/c1?tab=engagements&${CLIENT_ENGAGEMENT_VIEW_PARAM}=archived`);
    expect(CLIENT_ENGAGEMENT_VIEW_PARAM).not.toBe("tab");
  });

  it("round-trips: every href parses back to the view that made it", () => {
    for (const view of CLIENT_ENGAGEMENT_VIEWS) {
      const raw = new URL(
        clientEngagementViewHref("c1", view),
        "https://x.test",
      ).searchParams.get(CLIENT_ENGAGEMENT_VIEW_PARAM);
      expect(parseClientEngagementView(raw)).toBe(view);
      // ...and the tab itself survives, so the filter never drops you back to
      // the overview.
      const tab = new URL(
        clientEngagementViewHref("c1", view),
        "https://x.test",
      ).searchParams.get("tab");
      expect(parseClientTab(tab)).toBe("engagements");
    }
  });
});
