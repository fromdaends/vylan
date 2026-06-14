import { describe, it, expect } from "vitest";
import { aiEnabledFromRow } from "./engagement-ai";

// The toggle is fail-open by design: AI stays ON unless an engagement says
// ai_enabled=false. This guards the "default true" contract AND the
// pre-migration window where the column doesn't exist yet (row has no key).
describe("aiEnabledFromRow", () => {
  it("is OFF only when ai_enabled is explicitly false", () => {
    expect(aiEnabledFromRow({ ai_enabled: false })).toBe(false);
  });

  it("is ON when ai_enabled is true", () => {
    expect(aiEnabledFromRow({ ai_enabled: true })).toBe(true);
  });

  it("defaults ON when the column is absent (pre-migration row)", () => {
    expect(aiEnabledFromRow({})).toBe(true);
  });

  it("defaults ON for null / undefined rows", () => {
    expect(aiEnabledFromRow(null)).toBe(true);
    expect(aiEnabledFromRow(undefined)).toBe(true);
    expect(aiEnabledFromRow({ ai_enabled: null })).toBe(true);
  });
});
