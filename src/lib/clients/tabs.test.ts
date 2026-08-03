import { describe, it, expect } from "vitest";
import {
  CLIENT_TABS,
  parseClientTab,
  clientTabHref,
  CLIENT_ENGAGEMENT_VIEWS,
  CLIENT_ENGAGEMENT_VIEW_PARAM,
  parseClientEngagementView,
  clientEngagementViewHref,
  CLIENT_BOOKKEEPING_VIEWS,
  CLIENT_BOOKKEEPING_VIEW_PARAM,
  parseClientBookkeepingView,
  clientBookkeepingViewHref,
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

describe("the Files tab", () => {
  it("is a real tab, not a link to another route", () => {
    // It used to navigate to /clients/<id>/archive. Founder: "get rid of file
    // archive — it exists purely within the files on a client's page."
    expect(CLIENT_TABS).toContain("files");
    expect(clientTabHref("c1", "files")).toBe("/clients/c1?tab=files");
  });

  it("uses `tab`, which the embedded file browser never writes", () => {
    // The browser hosted on that tab writes client/folder/year/category/q/
    // type/status/sort/page. If it also wrote `tab`, one folder click would
    // navigate away from the tab that is rendering it.
    const BROWSER_PARAMS = [
      "client",
      "folder",
      "year",
      "category",
      "q",
      "type",
      "status",
      "sort",
      "page",
    ];
    expect(BROWSER_PARAMS).not.toContain("tab");
    expect(BROWSER_PARAMS).not.toContain(CLIENT_ENGAGEMENT_VIEW_PARAM);
  });
});

describe("parseClientBookkeepingView", () => {
  it("accepts every offered list", () => {
    for (const v of CLIENT_BOOKKEEPING_VIEWS) {
      expect(parseClientBookkeepingView(v)).toBe(v);
    }
  });

  it("falls back to missing receipts, including for the firm page's third tab", () => {
    // The firm-wide Bookkeeping page has a "documents" tab that this one does
    // not: the client page shows a client's documents on its own Files tab. A
    // link carrying it must land on a real list, not a blank panel.
    for (const junk of [undefined, null, "", "documents", "RECEIPTS", "../"]) {
      expect(parseClientBookkeepingView(junk)).toBe("receipts");
    }
  });
});

describe("clientBookkeepingViewHref", () => {
  it("leaves the default list as the bare tab URL", () => {
    expect(clientBookkeepingViewHref("c1", "receipts")).toBe(
      "/clients/c1?tab=bookkeeping",
    );
  });

  it("uses its own param — `tab` is already spent on the client page's tabs", () => {
    // This is the whole reason `bk` exists. A second `tab=` in the query would
    // navigate off the Bookkeeping tab on the first sub-tab click.
    expect(CLIENT_BOOKKEEPING_VIEW_PARAM).not.toBe("tab");
    expect(CLIENT_BOOKKEEPING_VIEW_PARAM).not.toBe(CLIENT_ENGAGEMENT_VIEW_PARAM);
    expect(clientBookkeepingViewHref("c1", "uncategorized")).toBe(
      `/clients/c1?tab=bookkeeping&${CLIENT_BOOKKEEPING_VIEW_PARAM}=uncategorized`,
    );
  });

  it("does not collide with what the shared bookkeeping components write", () => {
    // CloseBoard writes `period`; ReceiptGaps and UncategorizedList write
    // `client`, `from` and `to`. Each does it by mutating the CURRENT url, so
    // any name shared with this page's own params would be silently
    // overwritten mid-click.
    const WRITTEN_BY_SHARED_COMPONENTS = ["period", "client", "from", "to"];
    expect(WRITTEN_BY_SHARED_COMPONENTS).not.toContain("tab");
    expect(WRITTEN_BY_SHARED_COMPONENTS).not.toContain(
      CLIENT_BOOKKEEPING_VIEW_PARAM,
    );
    expect(WRITTEN_BY_SHARED_COMPONENTS).not.toContain(
      CLIENT_ENGAGEMENT_VIEW_PARAM,
    );
  });

  it("carries the close board's month across a sub-tab switch", () => {
    // Switching list must not silently reset which month you were closing —
    // the board sits directly above the tab strip.
    const href = clientBookkeepingViewHref("c1", "uncategorized", "2026-07");
    const url = new URL(href, "https://x.test");
    expect(url.searchParams.get("period")).toBe("2026-07");
    expect(parseClientTab(url.searchParams.get("tab"))).toBe("bookkeeping");
    expect(
      parseClientBookkeepingView(
        url.searchParams.get(CLIENT_BOOKKEEPING_VIEW_PARAM),
      ),
    ).toBe("uncategorized");
  });

  it("round-trips: every href parses back to the list that made it, tab intact", () => {
    for (const view of CLIENT_BOOKKEEPING_VIEWS) {
      const url = new URL(
        clientBookkeepingViewHref("c1", view, "2026-07"),
        "https://x.test",
      );
      expect(
        parseClientBookkeepingView(
          url.searchParams.get(CLIENT_BOOKKEEPING_VIEW_PARAM),
        ),
      ).toBe(view);
      expect(parseClientTab(url.searchParams.get("tab"))).toBe("bookkeeping");
    }
  });
});
