import { describe, it, expect } from "vitest";
import { sanitizeMentions } from "./mentions";

describe("sanitizeMentions", () => {
  const valid = new Set(["a", "b", "c"]);

  it("keeps only real members, drops the author + duplicates, preserves order", () => {
    expect(sanitizeMentions(["b", "a", "b", "x"], valid, "c")).toEqual([
      "b",
      "a",
    ]);
  });

  it("drops the author even if listed", () => {
    expect(sanitizeMentions(["a", "c"], valid, "c")).toEqual(["a"]);
  });

  it("drops unknown ids", () => {
    expect(sanitizeMentions(["x", "y"], valid, "z")).toEqual([]);
  });

  it("caps at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const big = new Set(many);
    expect(sanitizeMentions(many, big, "author")).toHaveLength(20);
  });
});
