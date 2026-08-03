import { describe, it, expect } from "vitest";
import {
  ROLE_COLORS,
  DEFAULT_ROLE_COLOR,
  isRoleColor,
  toRoleColor,
  roleColorClasses,
  roleSwatchClass,
  normalizeRoleName,
  ROLE_NAME_MAX,
} from "./palette";

describe("toRoleColor", () => {
  it("keeps a known colour", () => {
    expect(toRoleColor("violet")).toBe("violet");
  });

  it("falls back rather than throwing on anything else", () => {
    // A role coloured by a NEWER build has to render in an older one — during a
    // rollout both are live at once, and a thrown error here would take down a
    // whole settings page over a badge.
    expect(toRoleColor("chartreuse")).toBe(DEFAULT_ROLE_COLOR);
    expect(toRoleColor(null)).toBe(DEFAULT_ROLE_COLOR);
    expect(toRoleColor(undefined)).toBe(DEFAULT_ROLE_COLOR);
    expect(toRoleColor(42)).toBe(DEFAULT_ROLE_COLOR);
    expect(toRoleColor("#ff0000")).toBe(DEFAULT_ROLE_COLOR);
  });

  it("agrees with isRoleColor", () => {
    for (const c of ROLE_COLORS) expect(isRoleColor(c)).toBe(true);
    expect(isRoleColor("nope")).toBe(false);
  });
});

describe("the class maps", () => {
  it("cover every colour, with no gaps", () => {
    // A missing entry renders `undefined` into a className, which is an
    // unstyled badge rather than a crash — the kind of bug that ships.
    for (const c of ROLE_COLORS) {
      expect(roleColorClasses(c)).toBeTruthy();
      expect(roleSwatchClass(c)).toBeTruthy();
    }
  });

  it("never returns undefined for an unknown colour", () => {
    expect(roleColorClasses("chartreuse")).toBe(roleColorClasses(DEFAULT_ROLE_COLOR));
    expect(roleSwatchClass(undefined)).toBe(roleSwatchClass(DEFAULT_ROLE_COLOR));
  });

  it("writes classes out in full so Tailwind can find them", () => {
    // Built by interpolation they would exist in the markup and not in the
    // stylesheet — the classic way a dynamic palette ships looking unstyled.
    expect(roleColorClasses("blue")).toContain("bg-blue-500/10");
    expect(roleSwatchClass("blue")).toBe("bg-blue-500");
  });

  it("gives every colour a dark-theme text value", () => {
    for (const c of ROLE_COLORS) {
      expect(roleColorClasses(c)).toContain("dark:text-");
    }
  });
});

describe("normalizeRoleName", () => {
  it("trims", () => {
    expect(normalizeRoleName("  Partner  ")).toBe("Partner");
  });

  it("collapses inner whitespace", () => {
    // "Senior  reviewer" and "Senior reviewer" as two separate badges that look
    // identical in the list is a bug, not a feature.
    expect(normalizeRoleName("Senior   reviewer")).toBe("Senior reviewer");
    expect(normalizeRoleName("Tax\tlead")).toBe("Tax lead");
  });

  it("treats blank as no name", () => {
    expect(normalizeRoleName("")).toBeNull();
    expect(normalizeRoleName("   ")).toBeNull();
    expect(normalizeRoleName(null)).toBeNull();
    expect(normalizeRoleName(123)).toBeNull();
  });

  it("caps the length so one badge cannot push a roster row off screen", () => {
    expect(normalizeRoleName("x".repeat(200))).toHaveLength(ROLE_NAME_MAX);
  });
});
