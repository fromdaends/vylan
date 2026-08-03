import { describe, it, expect } from "vitest";
import {
  TEAM_PROFILE_TABS,
  parseTeamProfileTab,
  teamProfileTabHref,
} from "./profile-tabs";

describe("parseTeamProfileTab", () => {
  it("accepts every real tab", () => {
    for (const tab of TEAM_PROFILE_TABS) {
      expect(parseTeamProfileTab(tab)).toBe(tab);
    }
  });

  it("falls back to the overview instead of erroring", () => {
    for (const junk of [undefined, null, "", "  ", "billing", "OVERVIEW", "../"]) {
      expect(parseTeamProfileTab(junk)).toBe("overview");
    }
  });
});

describe("teamProfileTabHref", () => {
  it("leaves the overview as the bare profile URL", () => {
    expect(teamProfileTabHref("u1", "overview")).toBe("/settings/team/u1");
  });

  it("round-trips: every href parses back to the tab that made it", () => {
    for (const tab of TEAM_PROFILE_TABS) {
      const raw = new URL(
        teamProfileTabHref("u1", tab),
        "https://x.test",
      ).searchParams.get("tab");
      expect(parseTeamProfileTab(raw)).toBe(tab);
    }
  });

  it("does not collide with the lifecycle filter's own param", () => {
    // ?view= predates the tabs and is still what the Engagements filter writes.
    // If the tab had claimed `view`, every existing bookmark of
    // /settings/team/<id>?view=completed would have silently changed meaning.
    for (const tab of TEAM_PROFILE_TABS) {
      const url = new URL(teamProfileTabHref("u1", tab), "https://x.test");
      expect(url.searchParams.get("view")).toBeNull();
    }
  });
});
