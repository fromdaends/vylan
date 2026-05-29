import { describe, it, expect } from "vitest";
import {
  isActiveEngagement,
  isArchivedEngagement,
  isRecentlyDeletedEngagement,
  isPurgeableEngagement,
  daysUntilPurge,
  canDeleteEngagements,
  canArchiveEngagements,
  DELETED_RETENTION_DAYS,
} from "./lifecycle";

const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed "now" so every test is deterministic (no Date.now()).
const NOW = Date.parse("2026-05-29T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();

describe("isActiveEngagement", () => {
  it("is true only when neither archived nor deleted", () => {
    expect(isActiveEngagement({ archived_at: null, deleted_at: null })).toBe(
      true,
    );
  });
  it("is false when archived", () => {
    expect(
      isActiveEngagement({ archived_at: daysAgo(1), deleted_at: null }),
    ).toBe(false);
  });
  it("is false when soft-deleted", () => {
    expect(
      isActiveEngagement({ archived_at: null, deleted_at: daysAgo(1) }),
    ).toBe(false);
  });
});

describe("isArchivedEngagement", () => {
  it("is true when archived and not deleted", () => {
    expect(
      isArchivedEngagement({ archived_at: daysAgo(2), deleted_at: null }),
    ).toBe(true);
  });
  it("is false when also deleted — delete wins", () => {
    expect(
      isArchivedEngagement({ archived_at: daysAgo(2), deleted_at: daysAgo(1) }),
    ).toBe(false);
  });
  it("is false when active", () => {
    expect(
      isArchivedEngagement({ archived_at: null, deleted_at: null }),
    ).toBe(false);
  });
});

describe("isRecentlyDeletedEngagement", () => {
  it("is false when not deleted", () => {
    expect(isRecentlyDeletedEngagement({ deleted_at: null }, NOW)).toBe(false);
  });
  it("is true within the retention window", () => {
    expect(isRecentlyDeletedEngagement({ deleted_at: daysAgo(5) }, NOW)).toBe(
      true,
    );
  });
  it("includes the exact boundary day (deleted exactly 30 days ago)", () => {
    expect(
      isRecentlyDeletedEngagement(
        { deleted_at: daysAgo(DELETED_RETENTION_DAYS) },
        NOW,
      ),
    ).toBe(true);
  });
  it("is false once past the window", () => {
    expect(
      isRecentlyDeletedEngagement(
        { deleted_at: daysAgo(DELETED_RETENTION_DAYS + 1) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isPurgeableEngagement", () => {
  it("is false when not deleted", () => {
    expect(isPurgeableEngagement({ deleted_at: null }, NOW)).toBe(false);
  });
  it("is false within the window (still recoverable)", () => {
    expect(isPurgeableEngagement({ deleted_at: daysAgo(29) }, NOW)).toBe(false);
  });
  it("is false on the exact boundary day — complements isRecentlyDeleted", () => {
    expect(
      isPurgeableEngagement(
        { deleted_at: daysAgo(DELETED_RETENTION_DAYS) },
        NOW,
      ),
    ).toBe(false);
  });
  it("is true once older than the window", () => {
    expect(
      isPurgeableEngagement(
        { deleted_at: daysAgo(DELETED_RETENTION_DAYS + 1) },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("daysUntilPurge", () => {
  it("is the full window right after deletion", () => {
    expect(daysUntilPurge(daysAgo(0), NOW)).toBe(DELETED_RETENTION_DAYS);
  });
  it("counts down (deleted 23 days ago → 7 left)", () => {
    expect(daysUntilPurge(daysAgo(23), NOW)).toBe(7);
  });
  it("is 0 at/after the window, never negative", () => {
    expect(daysUntilPurge(daysAgo(DELETED_RETENTION_DAYS), NOW)).toBe(0);
    expect(daysUntilPurge(daysAgo(DELETED_RETENTION_DAYS + 9), NOW)).toBe(0);
  });
});

describe("permission helpers", () => {
  it("only the owner can soft-delete / restore", () => {
    expect(canDeleteEngagements("owner")).toBe(true);
    expect(canDeleteEngagements("staff")).toBe(false);
  });
  it("archive is always allowed (any role)", () => {
    expect(canArchiveEngagements()).toBe(true);
  });
});
