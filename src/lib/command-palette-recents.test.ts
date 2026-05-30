import { describe, it, expect, beforeEach } from "vitest";
import {
  readRecentSearches,
  recordSearch,
  readRecentItems,
  recordItem,
  clearRecents,
  type RecentItem,
} from "./command-palette-recents";

beforeEach(() => localStorage.clear());

describe("command-palette recent searches", () => {
  it("returns empty when nothing recorded", () => {
    expect(readRecentSearches()).toEqual([]);
  });

  it("records a search, most-recent-first", () => {
    recordSearch("alpha");
    recordSearch("beta");
    expect(readRecentSearches()).toEqual(["beta", "alpha"]);
  });

  it("trims and ignores blank queries", () => {
    recordSearch("  spaced  ");
    recordSearch("   ");
    expect(readRecentSearches()).toEqual(["spaced"]);
  });

  it("dedupes case-insensitively, promoting the repeat to the front", () => {
    recordSearch("Bouchard");
    recordSearch("tremblay");
    recordSearch("bouchard");
    expect(readRecentSearches()).toEqual(["bouchard", "tremblay"]);
  });

  it("caps at six entries", () => {
    for (const q of ["a", "b", "c", "d", "e", "f", "g"]) recordSearch(q);
    const got = readRecentSearches();
    expect(got).toHaveLength(6);
    expect(got[0]).toBe("g");
    expect(got).not.toContain("a");
  });

  it("ignores malformed storage", () => {
    localStorage.setItem("vylan:cmdk:searches", "not json");
    expect(readRecentSearches()).toEqual([]);
  });
});

describe("command-palette recent items", () => {
  const client: RecentItem = {
    kind: "client",
    id: "c1",
    title: "Bouchard",
    subtitle: "b@x.com",
  };
  const eng: RecentItem = {
    kind: "engagement",
    id: "e1",
    title: "T1 2025",
    subtitle: "Bouchard",
  };

  it("records items most-recent-first", () => {
    recordItem(client);
    recordItem(eng);
    expect(readRecentItems().map((i) => i.id)).toEqual(["e1", "c1"]);
  });

  it("dedupes by kind+id, promoting the repeat", () => {
    recordItem(client);
    recordItem(eng);
    recordItem(client);
    expect(readRecentItems().map((i) => i.id)).toEqual(["c1", "e1"]);
  });

  it("treats same id of different kinds as distinct", () => {
    recordItem({ kind: "client", id: "x", title: "C" });
    recordItem({ kind: "engagement", id: "x", title: "E" });
    expect(readRecentItems()).toHaveLength(2);
  });

  it("drops items without an id or title and malformed rows", () => {
    localStorage.setItem(
      "vylan:cmdk:items",
      JSON.stringify([{ kind: "client", id: "ok", title: "Keep" }, { foo: 1 }]),
    );
    expect(readRecentItems().map((i) => i.id)).toEqual(["ok"]);
  });

  it("omits an undefined subtitle from storage", () => {
    recordItem({ kind: "client", id: "n", title: "NoSub" });
    expect(readRecentItems()[0]).toEqual({
      kind: "client",
      id: "n",
      title: "NoSub",
    });
  });

  it("caps at six entries", () => {
    for (let i = 0; i < 8; i++)
      recordItem({ kind: "engagement", id: `e${i}`, title: `E${i}` });
    expect(readRecentItems()).toHaveLength(6);
  });
});

describe("clearRecents", () => {
  it("wipes both lists", () => {
    recordSearch("alpha");
    recordItem({ kind: "client", id: "c1", title: "Bouchard" });
    clearRecents();
    expect(readRecentSearches()).toEqual([]);
    expect(readRecentItems()).toEqual([]);
  });
});
