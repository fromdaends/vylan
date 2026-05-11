import { describe, it, expect } from "vitest";
import { isValidTokenShape } from "./portal";

describe("isValidTokenShape", () => {
  it("accepts a 43-char URL-safe token (the shape newMagicToken emits)", () => {
    const sample = "a".repeat(43);
    expect(isValidTokenShape(sample)).toBe(true);
    expect(isValidTokenShape("AbC0123" + "x".repeat(36))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidTokenShape("")).toBe(false);
    expect(isValidTokenShape("short")).toBe(false);
    expect(isValidTokenShape("a".repeat(42))).toBe(false);
    expect(isValidTokenShape("a".repeat(44))).toBe(false);
  });

  it("rejects non-URL-safe characters", () => {
    const base = "a".repeat(42);
    expect(isValidTokenShape(base + "/")).toBe(false);
    expect(isValidTokenShape(base + "=")).toBe(false);
    expect(isValidTokenShape(base + "+")).toBe(false);
    expect(isValidTokenShape(base + " ")).toBe(false);
    expect(isValidTokenShape(base + "_")).toBe(false);
  });
});
