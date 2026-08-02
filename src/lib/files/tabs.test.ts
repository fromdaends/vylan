import { describe, it, expect } from "vitest";
import { resolveFilesTab } from "./tabs";

// The one behavior that must never regress: every pre-Home deep link into
// Browse (they all rely on Browse having been the default, none carry a tab
// param) still lands on Browse. Only a bare /files gets the new Home.
describe("resolveFilesTab", () => {
  it("bare /files lands on Home", () => {
    expect(resolveFilesTab({})).toBe("home");
  });

  it("an explicit tab always wins", () => {
    expect(resolveFilesTab({ tab: "home", client: "c1" })).toBe("home");
    expect(resolveFilesTab({ tab: "browse" })).toBe("browse");
    expect(resolveFilesTab({ tab: "settings", client: "c1" })).toBe("settings");
  });

  it("every browse-state param implies Browse — the deep-link contract", () => {
    for (const sp of [
      { client: "c1" },
      { folder: "f1" },
      { year: "2026" },
      { category: "bookkeeping" },
      { q: "t4" },
      { type: "t4_slip" },
      { status: "approved" },
      { sort: "date" },
      { page: "2" },
    ]) {
      expect(resolveFilesTab(sp), JSON.stringify(sp)).toBe("browse");
    }
  });

  it("blank params do not count", () => {
    expect(resolveFilesTab({ client: "  ", q: "" })).toBe("home");
  });

  it("an unknown tab value falls back to inference, not a crash", () => {
    expect(resolveFilesTab({ tab: "bogus" })).toBe("home");
    expect(resolveFilesTab({ tab: "bogus", client: "c1" })).toBe("browse");
  });
});
