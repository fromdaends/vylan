import { describe, it, expect } from "vitest";
import {
  isNavItemActive,
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

  it("classifies a cancelled engagement as Cancelled", () => {
    expect(
      engagementToView(
        { ...base, status: "cancelled" },
        { readyToReview: false },
      ),
    ).toBe("cancelled");
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
    // Cancelled beats Ready.
    expect(
      engagementToView(
        { ...base, status: "cancelled" },
        { readyToReview: true },
      ),
    ).toBe("cancelled");
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
