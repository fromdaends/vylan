import { describe, it, expect } from "vitest";
import { parseEmailList } from "@/lib/validators";

describe("parseEmailList", () => {
  it("splits on newlines, commas, and whitespace", () => {
    const out = parseEmailList("a@x.com, b@y.com\nc@z.com  d@w.com");
    expect(out).toEqual(["a@x.com", "b@y.com", "c@z.com", "d@w.com"]);
  });

  it("drops invalid entries", () => {
    const out = parseEmailList("good@x.com\nnope\nalso@y.com");
    expect(out).toEqual(["good@x.com", "also@y.com"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList("   ")).toEqual([]);
  });
});
