import { describe, it, expect, beforeEach } from "vitest";
import { recordOpen, readRecentOpenId } from "./jump-back";

const KEY = "vylan:jump-back";
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => localStorage.clear());

describe("jump-back recency tracking", () => {
  it("returns the engagement id right after recording an open", () => {
    recordOpen("eng-1");
    expect(readRecentOpenId()).toBe("eng-1");
  });

  it("returns null when nothing has been opened", () => {
    expect(readRecentOpenId()).toBeNull();
  });

  it("expires once the open is older than the window", () => {
    // 8 days ago — past the 7-day window.
    localStorage.setItem(
      KEY,
      JSON.stringify({ id: "eng-1", openedAt: Date.now() - 8 * DAY }),
    );
    expect(readRecentOpenId()).toBeNull();
  });

  it("still returns within the window", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ id: "eng-1", openedAt: Date.now() - 2 * DAY }),
    );
    expect(readRecentOpenId()).toBe("eng-1");
  });

  it("ignores malformed storage", () => {
    localStorage.setItem(KEY, "not json");
    expect(readRecentOpenId()).toBeNull();
  });
});
