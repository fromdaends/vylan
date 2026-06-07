import { describe, it, expect } from "vitest";
import {
  PROVINCES,
  TIMEZONES,
  INDUSTRIES,
  PROVINCE_VALUES,
  INDUSTRY_VALUES,
  fieldLabel,
} from "./fields";

describe("client field options", () => {
  it("has the expected counts (13 provinces, 6 timezones, 32 industries)", () => {
    expect(PROVINCES).toHaveLength(13);
    expect(TIMEZONES).toHaveLength(6);
    expect(INDUSTRIES).toHaveLength(32);
  });

  it("has unique, non-empty values everywhere", () => {
    for (const list of [PROVINCES, TIMEZONES, INDUSTRIES]) {
      const values = list.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values.every((v) => v.trim().length > 0)).toBe(true);
      expect(list.every((o) => o.en.trim() && o.fr.trim())).toBe(true);
    }
  });

  it("never uses the 'none' sentinel as a real value", () => {
    const all = [...PROVINCE_VALUES, ...INDUSTRY_VALUES];
    expect(all).not.toContain("none");
    expect(all).not.toContain("");
  });

  it("fieldLabel localizes, falls back to the raw value, and handles null", () => {
    expect(fieldLabel(PROVINCES, "QC", "fr")).toBe("Québec");
    expect(fieldLabel(PROVINCES, "QC", "en")).toBe("Quebec");
    expect(fieldLabel(INDUSTRIES, "real_estate", "en")).toBe("Real Estate");
    expect(fieldLabel(PROVINCES, null, "en")).toBeNull();
    expect(fieldLabel(PROVINCES, undefined, "en")).toBeNull();
    // Unknown value: return it as-is rather than dropping it.
    expect(fieldLabel(PROVINCES, "ZZ", "en")).toBe("ZZ");
  });
});
