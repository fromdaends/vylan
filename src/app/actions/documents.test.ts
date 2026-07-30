import { describe, expect, it } from "vitest";
import { sanitizeDisplayName } from "@/lib/files/display-name";

// This function's regex was wrong twice while being written — once eating every
// hyphen, once matching the letter "s" instead of whitespace. Both would have
// silently mangled names on rename with nothing to notice it. Hence the tests.
describe("sanitizeDisplayName", () => {
  it("leaves a Vylan-generated name completely alone", () => {
    // The exact shape lib/ai/display-name.ts produces. If this ever fails, the
    // rename box is corrupting the app's own naming convention.
    const name = "T4 - 2024 - Hydro-Quebec.pdf";
    expect(sanitizeDisplayName(name)).toBe(name);
  });

  it("does not eat the letter s", () => {
    expect(sanitizeDisplayName("Bank statements 2024")).toBe(
      "Bank statements 2024",
    );
  });

  it("keeps accents, apostrophes and French names intact", () => {
    expect(sanitizeDisplayName("Relevé 1 — Tremblay & Fils")).toBe(
      "Relevé 1 — Tremblay & Fils",
    );
  });

  it("strips path separators so a name can never imply a directory", () => {
    expect(sanitizeDisplayName("folder/sub/file.pdf")).toBe("folder sub file.pdf");
    expect(sanitizeDisplayName("C:\\Users\\zach\\t4.pdf")).toBe("C: Users zach t4.pdf");
  });

  it("strips control characters", () => {
    expect(sanitizeDisplayName("bad\u0000name\u001fhere\u007f")).toBe(
      "bad name here",
    );
  });

  it("collapses runs of whitespace and trims", () => {
    expect(sanitizeDisplayName("  spaced    out  ")).toBe("spaced out");
    expect(sanitizeDisplayName("tabs\there")).toBe("tabs here");
  });

  it("returns empty for input that is only junk, so the caller can reject it", () => {
    expect(sanitizeDisplayName("   ")).toBe("");
    expect(sanitizeDisplayName("///")).toBe("");
    expect(sanitizeDisplayName("")).toBe("");
  });

  it("caps the length", () => {
    expect(sanitizeDisplayName("a".repeat(500))).toHaveLength(200);
  });
});
