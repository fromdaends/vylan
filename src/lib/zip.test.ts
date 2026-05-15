import { describe, it, expect } from "vitest";
import { sanitizeFilenamePart } from "./zip";

describe("sanitizeFilenamePart", () => {
  it("removes slashes and backslashes outright", () => {
    expect(sanitizeFilenamePart("a/b\\c")).toBe("abc");
  });

  it("removes Windows-reserved characters outright", () => {
    expect(sanitizeFilenamePart('foo<bar>:"|?*')).toBe("foobar");
  });

  it("strips leading dots so the result isn't a hidden file", () => {
    expect(sanitizeFilenamePart("...hidden")).toBe("hidden");
    expect(sanitizeFilenamePart(".env")).toBe("env");
  });

  it("collapses whitespace runs (including tabs/newlines) to a single space", () => {
    expect(sanitizeFilenamePart("a   b\t\nc")).toBe("a b c");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeFilenamePart("   hi   ")).toBe("hi");
  });

  it("strips ASCII control characters (bell, backspace, etc.)", () => {
    expect(sanitizeFilenamePart("hi\x07the\x08re")).toBe("hithere");
  });

  it("hard-caps length to the supplied max", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilenamePart(long, 50)).toHaveLength(50);
  });

  it("falls back to 'untitled' when sanitization empties the input", () => {
    expect(sanitizeFilenamePart("///")).toBe("untitled");
    expect(sanitizeFilenamePart("...")).toBe("untitled");
    expect(sanitizeFilenamePart("")).toBe("untitled");
  });

  it("preserves accented characters and dashes", () => {
    expect(sanitizeFilenamePart("Tremblay-Côté")).toBe("Tremblay-Côté");
  });
});
