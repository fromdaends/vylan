import { describe, it, expect } from "vitest";
import { postingLineDescription, postingReference } from "./suggest";

describe("postingLineDescription", () => {
  it("joins the party name with a summary of the first few line items", () => {
    expect(
      postingLineDescription("Central Copiers", [
        { description: "Printer paper" },
        { description: "Toner cartridge" },
        { description: "Binding combs" },
      ]),
    ).toBe("Central Copiers — Printer paper, Toner cartridge, Binding combs");
  });

  it("caps the summary at three items with an ellipsis", () => {
    const out = postingLineDescription("Vendor", [
      { description: "a" },
      { description: "b" },
      { description: "c" },
      { description: "d" },
    ]);
    expect(out).toBe("Vendor — a, b, c…");
  });

  it("falls back to the party name alone when there are no lines", () => {
    expect(postingLineDescription("Central Copiers", [])).toBe(
      "Central Copiers",
    );
    expect(postingLineDescription("Central Copiers", undefined)).toBe(
      "Central Copiers",
    );
  });

  it("falls back to a generic label when there's nothing", () => {
    expect(postingLineDescription(null, [])).toBe("Posted from Vylan");
  });

  it("truncates a very long description", () => {
    const long = "x".repeat(500);
    const out = postingLineDescription(long, []);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("postingReference", () => {
  it("trims and passes through a normal reference", () => {
    expect(postingReference("  CC-20418 ")).toBe("CC-20418");
  });
  it("returns null for empty/absent", () => {
    expect(postingReference(null)).toBeNull();
    expect(postingReference(undefined)).toBeNull();
    expect(postingReference("   ")).toBeNull();
  });
  it("caps at QuickBooks' 21-char DocNumber limit", () => {
    expect(postingReference("A".repeat(30))).toHaveLength(21);
  });
});
