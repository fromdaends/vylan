import { describe, it, expect } from "vitest";
import { normalizeHandoffNote, HANDOFF_NOTE_MAX } from "./handoff-note";

describe("normalizeHandoffNote", () => {
  it("keeps a real note, trimmed", () => {
    expect(normalizeHandoffNote("  check the T4  ")).toBe("check the T4");
  });

  it("treats blank / whitespace-only as no note", () => {
    expect(normalizeHandoffNote("")).toBeNull();
    expect(normalizeHandoffNote("   ")).toBeNull();
    expect(normalizeHandoffNote("\n\t")).toBeNull();
  });

  it("treats non-strings as no note", () => {
    expect(normalizeHandoffNote(null)).toBeNull();
    expect(normalizeHandoffNote(undefined)).toBeNull();
  });

  it("caps length at the max", () => {
    const long = "x".repeat(HANDOFF_NOTE_MAX + 50);
    expect(normalizeHandoffNote(long)).toHaveLength(HANDOFF_NOTE_MAX);
  });
});
