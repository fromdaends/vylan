import { describe, expect, it } from "vitest";
import { normalizeAiRules } from "./request-items";

describe("normalizeAiRules", () => {
  it("keeps real rules, trimmed", () => {
    expect(normalizeAiRules("  Must show 2025.  ")).toBe("Must show 2025.");
  });

  it("collapses blank / whitespace / nullish to null", () => {
    expect(normalizeAiRules("")).toBeNull();
    expect(normalizeAiRules("   ")).toBeNull();
    expect(normalizeAiRules(null)).toBeNull();
    expect(normalizeAiRules(undefined)).toBeNull();
  });
});
