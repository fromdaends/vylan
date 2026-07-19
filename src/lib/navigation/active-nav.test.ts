import { describe, it, expect } from "vitest";
import {
  isNavItemActive,
  isIntegrationsSectionActive,
  isIntegrationSubItemVisible,
  engagementToView,
  isEngagementViewActive,
  type EngagementForView,
} from "./active-nav";

describe("isNavItemActive", () => {
  it("matches /dashboard only on the exact path (it's a leaf route)", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard/anything", "/dashboard")).toBe(false);
  });

  it("matches a section on its own page and any nested route", () => {
    expect(isNavItemActive("/clients", "/clients")).toBe(true);
    expect(isNavItemActive("/clients/123", "/clients")).toBe(true);
    expect(isNavItemActive("/clients/import", "/clients")).toBe(true);
  });

  it("keeps the Engagements parent lit on every sub-route and detail page", () => {
    expect(isNavItemActive("/engagements", "/engagements")).toBe(true);
    expect(isNavItemActive("/engagements/ready", "/engagements")).toBe(true);
    expect(isNavItemActive("/engagements/abc-123", "/engagements")).toBe(true);
  });

  it("does not match an unrelated route that only shares a prefix", () => {
    expect(isNavItemActive("/engagements-archive", "/engagements")).toBe(false);
    expect(isNavItemActive("/clients", "/dashboard")).toBe(false);
  });
});

describe("isIntegrationsSectionActive", () => {
  it("lights on the Integrations hub index and its Sage sub-route", () => {
    expect(isIntegrationsSectionActive("/integrations")).toBe(true);
    expect(isIntegrationsSectionActive("/integrations/sage")).toBe(true);
  });

  it("also lights on the pre-existing QuickBooks surface", () => {
    expect(isIntegrationsSectionActive("/quickbooks/drafts")).toBe(true);
  });

  it("stays off on unrelated routes", () => {
    expect(isIntegrationsSectionActive("/engagements")).toBe(false);
    expect(isIntegrationsSectionActive("/dashboard")).toBe(false);
    // shares a prefix but isn't the section
    expect(isIntegrationsSectionActive("/integrations-old")).toBe(false);
  });
});

describe("isIntegrationSubItemVisible", () => {
  it("always shows Sage 50 — it's a file export with nothing to connect", () => {
    expect(isIntegrationSubItemVisible("sage", false)).toBe(true);
    expect(isIntegrationSubItemVisible("sage", true)).toBe(true);
  });

  it("shows QuickBooks only once the firm has connected a client", () => {
    expect(isIntegrationSubItemVisible("quickbooks", false)).toBe(false);
    expect(isIntegrationSubItemVisible("quickbooks", true)).toBe(true);
  });
});

describe("engagementToView", () => {
  const base: EngagementForView = {
    status: "in_progress",
    archived_at: null,
    deleted_at: null,
  };

  it("classifies a live in-progress engagement as Active", () => {
    expect(engagementToView(base, { readyToReview: false })).toBe("active");
  });

  it("classifies a draft as Drafts", () => {
    expect(
      engagementToView({ ...base, status: "draft" }, { readyToReview: false }),
    ).toBe("drafts");
  });

  it("classifies a ready engagement as Ready (over Active)", () => {
    expect(engagementToView(base, { readyToReview: true })).toBe("ready");
  });

  it("classifies a completed engagement as Completed", () => {
    expect(
      engagementToView(
        { ...base, status: "complete" },
        { readyToReview: false },
      ),
    ).toBe("completed");
  });

  // Cancelled has no sub-item to light up any more (see lib/engagements/views.ts
  // — cancelling isn't reachable from the UI, so the tab went). A legacy
  // cancelled engagement, reachable only via the command palette, falls through
  // to the section root rather than highlighting nothing.
  it("falls a cancelled engagement through to Active — it has no view of its own", () => {
    expect(
      engagementToView(
        { ...base, status: "cancelled" },
        { readyToReview: false },
      ),
    ).toBe("active");
  });

  it("classifies an archived engagement as Archived regardless of status", () => {
    expect(
      engagementToView(
        { ...base, status: "cancelled", archived_at: "2026-01-01T00:00:00Z" },
        { readyToReview: false },
      ),
    ).toBe("archived");
  });

  it("classifies a soft-deleted engagement as Recently deleted, even if archived first", () => {
    expect(
      engagementToView(
        {
          ...base,
          archived_at: "2026-01-01T00:00:00Z",
          deleted_at: "2026-02-01T00:00:00Z",
        },
        { readyToReview: false },
      ),
    ).toBe("deleted");
  });

  it("honours the priority order on overlapping states", () => {
    // Ready now wins over a cancelled status, which no longer classifies.
    expect(
      engagementToView(
        { ...base, status: "cancelled" },
        { readyToReview: true },
      ),
    ).toBe("ready");
    // Deleted beats everything.
    expect(
      engagementToView(
        { ...base, status: "complete", deleted_at: "2026-02-01T00:00:00Z" },
        { readyToReview: false },
      ),
    ).toBe("deleted");
  });
});

describe("isEngagementViewActive", () => {
  it("matches a list sub-page by exact route when no detail view is set", () => {
    expect(isEngagementViewActive("/engagements", "active")).toBe(true);
    expect(isEngagementViewActive("/engagements/ready", "ready")).toBe(true);
    expect(isEngagementViewActive("/engagements/ready", "active")).toBe(false);
  });

  it("on a detail page, lights the sub-view matching the engagement's state", () => {
    // detailView supplied → we're on /engagements/[id]; the path is ignored.
    expect(isEngagementViewActive("/engagements/abc", "drafts", "drafts")).toBe(
      true,
    );
    expect(isEngagementViewActive("/engagements/abc", "active", "drafts")).toBe(
      false,
    );
  });
});
