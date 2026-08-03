import { describe, it, expect } from "vitest";
import { computeInitials } from "./avatar-initials";

describe("computeInitials", () => {
  // THE REGRESSION. computeInitials was exported specifically so the portal
  // would not grow "a second, drifting copy" — its own comment says so. The
  // portal then wrote two copies anyway (the gate page and the portal shell),
  // and they took the first TWO words instead of first-and-last. A three-word
  // firm therefore showed different initials in the portal than in the app.
  it("takes the first and last word, not the first two", () => {
    expect(computeInitials("Smith Jones Bookkeeping")).toBe("SB");
    expect(computeInitials("Gagnon Tremblay Associes CPA")).toBe("GC");
  });

  it("handles the ordinary two-word case", () => {
    expect(computeInitials("Acme Inc")).toBe("AI");
  });

  it("takes two letters from a single word", () => {
    expect(computeInitials("Vylan")).toBe("VY");
  });

  it("splits on dots, underscores and hyphens as well as spaces", () => {
    // The hand-rolled portal copies split on whitespace only, so a firm styled
    // "smith-jones" collapsed to a single initial there.
    expect(computeInitials("smith-jones")).toBe("SJ");
    expect(computeInitials("smith.jones")).toBe("SJ");
    expect(computeInitials("smith_jones")).toBe("SJ");
  });

  it("uses the local part of an email", () => {
    // The portal copies had no email handling at all — "a@b.com" would have
    // produced "A" from the whole string.
    expect(computeInitials("marie.tremblay@example.com")).toBe("MT");
  });

  it("falls back to a placeholder rather than an empty badge", () => {
    // The hand-rolled copies returned "" here, which renders as a blank disc.
    expect(computeInitials("")).toBe("?");
    expect(computeInitials("   ")).toBe("?");
  });
});
