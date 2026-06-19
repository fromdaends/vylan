import { describe, it, expect } from "vitest";
import {
  isOwnerOnlySettingsSection,
  visibleSettingsSections,
  OWNER_ONLY_SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./owner-sections";

const ALL: SettingsSectionId[] = [
  "account",
  "security",
  "appearance",
  "general",
  "payments",
  "documents",
];

describe("isOwnerOnlySettingsSection", () => {
  it("payments + documents are owner-only", () => {
    expect(isOwnerOnlySettingsSection("payments")).toBe(true);
    expect(isOwnerOnlySettingsSection("documents")).toBe(true);
  });
  it("account / security / appearance / general are not", () => {
    for (const id of ["account", "security", "appearance", "general"]) {
      expect(isOwnerOnlySettingsSection(id)).toBe(false);
    }
  });
});

describe("visibleSettingsSections", () => {
  it("owners see every section", () => {
    expect(visibleSettingsSections(ALL, true)).toEqual(ALL);
  });

  it("staff never see Payments or Documents, but keep their own tabs", () => {
    const staff = visibleSettingsSections(ALL, false);
    expect(staff).not.toContain("payments");
    expect(staff).not.toContain("documents");
    expect(staff).toEqual(["account", "security", "appearance", "general"]);
  });

  it("every OWNER_ONLY section is hidden from staff", () => {
    const staff = visibleSettingsSections(ALL, false);
    for (const id of OWNER_ONLY_SETTINGS_SECTIONS) {
      expect(staff).not.toContain(id);
    }
  });
});
