import { describe, it, expect } from "vitest";
import {
  buildSearchRegistry,
  matchEntries,
  normalizeSearch,
  type RegistryTranslators,
} from "./registry";

// Identity translators: each label becomes its i18n key, which is enough to
// exercise the matcher (labels like "section_timezone" still contain the words
// we search for, and the hidden bilingual `keywords` carry the synonyms).
const id = (k: string) => k;
const translators: RegistryTranslators = {
  app: id,
  eng: id,
  set: id,
  profile: id,
  auth: id,
  cmd: id,
};

describe("normalizeSearch", () => {
  it("folds case and strips accents", () => {
    expect(normalizeSearch("Sécurité")).toBe("securite");
    expect(normalizeSearch("  Français  ")).toBe("francais");
    expect(normalizeSearch("Two   Factor")).toBe("two factor");
  });
});

describe("buildSearchRegistry", () => {
  it("hides owner-only entries from staff", () => {
    const staff = buildSearchRegistry(translators, { isOwner: false });
    const owner = buildSearchRegistry(translators, { isOwner: true });
    for (const ownerOnlyId of ["billing", "audit", "export", "delete-firm"]) {
      expect(staff.some((e) => e.id === ownerOnlyId)).toBe(false);
      expect(owner.some((e) => e.id === ownerOnlyId)).toBe(true);
    }
  });

  it("flags the primary destinations shown in the idle list", () => {
    const reg = buildSearchRegistry(translators, { isOwner: true });
    const primary = reg.filter((e) => e.primary).map((e) => e.id);
    expect(primary).toEqual(
      expect.arrayContaining([
        "dashboard",
        "clients",
        "engagements",
        "templates",
        "settings",
      ]),
    );
  });

  it("every entry is either a navigation or an action, never both", () => {
    const reg = buildSearchRegistry(translators, { isOwner: true });
    for (const e of reg) {
      expect(Boolean(e.href) !== Boolean(e.action)).toBe(true);
    }
  });
});

describe("matchEntries", () => {
  const reg = buildSearchRegistry(translators, { isOwner: true });
  const ids = (q: string) => matchEntries(reg, q).map((e) => e.id);

  it("finds two-factor by abbreviation and synonyms", () => {
    expect(ids("2fa")).toContain("two-factor");
    expect(ids("mfa")).toContain("two-factor");
    expect(ids("authenticator")).toContain("two-factor");
  });

  it("finds settings 'small things' by keyword, in either language", () => {
    expect(ids("timezone")).toContain("timezone");
    expect(ids("fuseau")).toContain("timezone"); // French synonym
    expect(ids("export")).toContain("export");
    expect(ids("audit")).toContain("audit");
    expect(ids("billing")).toContain("billing");
  });

  it("finds theme actions, including multi-word", () => {
    expect(ids("dark")).toContain("theme-dark");
    expect(ids("dark mode")).toContain("theme-dark");
    expect(ids("systeme")).toContain("theme-system"); // accent-folded French
  });

  it("is accent-insensitive on the query", () => {
    expect(ids("sécurité")).toContain("two-factor");
  });

  it("AND-matches multi-word queries across label + keywords", () => {
    expect(ids("import clients")).toContain("import-clients");
    expect(ids("recently deleted")).toContain("eng-deleted");
  });

  it("returns nothing for blank or non-matching queries", () => {
    expect(matchEntries(reg, "")).toEqual([]);
    expect(matchEntries(reg, "   ")).toEqual([]);
    expect(ids("zzzzz")).toEqual([]);
  });
});
