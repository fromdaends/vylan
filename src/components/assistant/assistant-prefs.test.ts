import { beforeEach, describe, expect, it } from "vitest";
import {
  BADGE_MAX_AGE_DAYS,
  clampPanelWidth,
  clearStoredPanelWidth,
  defaultPanelWidth,
  isFreshEngagement,
  markEngagementSeen,
  PANEL_MIN_WIDTH_PX,
  readSeenEngagements,
  readStoredPanelWidth,
  storePanelWidth,
} from "./assistant-prefs";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("clampPanelWidth", () => {
  it("keeps a width inside the bounds unchanged", () => {
    expect(clampPanelWidth(600, 1600)).toBe(600);
  });

  it("clamps below the 400px minimum up to the minimum", () => {
    expect(clampPanelWidth(100, 1600)).toBe(PANEL_MIN_WIDTH_PX);
  });

  it("clamps above 60% of the viewport down to 60%", () => {
    expect(clampPanelWidth(2000, 1600)).toBe(960);
  });

  it("never produces max < min on tiny viewports", () => {
    // 60% of 500 = 300 < the 400 minimum — min wins.
    expect(clampPanelWidth(9999, 500)).toBe(PANEL_MIN_WIDTH_PX);
    expect(clampPanelWidth(1, 500)).toBe(PANEL_MIN_WIDTH_PX);
  });
});

describe("defaultPanelWidth", () => {
  it("is 35% of the viewport on a normal desktop", () => {
    expect(defaultPanelWidth(2000)).toBe(700);
  });

  it("respects the 400px floor on narrow viewports", () => {
    // 35% of 800 = 280 → floor at 400.
    expect(defaultPanelWidth(800)).toBe(PANEL_MIN_WIDTH_PX);
  });
});

describe("width persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a stored width per user", () => {
    storePanelWidth("user-a", 550);
    expect(readStoredPanelWidth("user-a")).toBe(550);
    expect(readStoredPanelWidth("user-b")).toBeNull();
  });

  it("clear removes the stored width (double-click reset)", () => {
    storePanelWidth("user-a", 550);
    clearStoredPanelWidth("user-a");
    expect(readStoredPanelWidth("user-a")).toBeNull();
  });

  it("rejects garbage stored values", () => {
    window.localStorage.setItem("vylan:assistant:width:user-a", "banana");
    expect(readStoredPanelWidth("user-a")).toBeNull();
    window.localStorage.setItem("vylan:assistant:width:user-a", "-20");
    expect(readStoredPanelWidth("user-a")).toBeNull();
  });
});

describe("seen engagements (badge)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("marks and reads per user, most recent first", () => {
    markEngagementSeen("u1", "e1");
    markEngagementSeen("u1", "e2");
    expect(readSeenEngagements("u1")).toEqual(["e2", "e1"]);
    expect(readSeenEngagements("u2")).toEqual([]);
  });

  it("re-marking moves an id to the front without duplicating", () => {
    markEngagementSeen("u1", "e1");
    markEngagementSeen("u1", "e2");
    markEngagementSeen("u1", "e1");
    expect(readSeenEngagements("u1")).toEqual(["e1", "e2"]);
  });

  it("caps the list at 100 ids", () => {
    for (let i = 0; i < 120; i++) {
      markEngagementSeen("u1", `e${i}`);
    }
    const seen = readSeenEngagements("u1");
    expect(seen).toHaveLength(100);
    expect(seen[0]).toBe("e119");
  });

  it("survives corrupted storage", () => {
    window.localStorage.setItem("vylan:assistant:seen:u1", "{not json");
    expect(readSeenEngagements("u1")).toEqual([]);
    window.localStorage.setItem(
      "vylan:assistant:seen:u1",
      JSON.stringify({ nope: true }),
    );
    expect(readSeenEngagements("u1")).toEqual([]);
  });
});

describe("isFreshEngagement", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");

  it("draft and sent engagements created recently are fresh", () => {
    const yesterday = new Date(now - DAY_MS).toISOString();
    expect(isFreshEngagement("draft", yesterday, now)).toBe(true);
    expect(isFreshEngagement("sent", yesterday, now)).toBe(true);
  });

  it("other statuses are never fresh", () => {
    const yesterday = new Date(now - DAY_MS).toISOString();
    expect(isFreshEngagement("in_progress", yesterday, now)).toBe(false);
    expect(isFreshEngagement("complete", yesterday, now)).toBe(false);
    expect(isFreshEngagement("cancelled", yesterday, now)).toBe(false);
  });

  it("expires after the max age", () => {
    const old = new Date(
      now - (BADGE_MAX_AGE_DAYS + 1) * DAY_MS,
    ).toISOString();
    expect(isFreshEngagement("sent", old, now)).toBe(false);
  });

  it("rejects unparseable and future dates", () => {
    expect(isFreshEngagement("sent", "not-a-date", now)).toBe(false);
    const future = new Date(now + DAY_MS).toISOString();
    expect(isFreshEngagement("sent", future, now)).toBe(false);
  });
});
