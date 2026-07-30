import { describe, expect, it } from "vitest";
import {
  applyDerivedAxes,
  BROWSE_CATEGORIES,
  categoryForDocType,
  deriveBrowseAxes,
  isBrowseCategory,
  resolveDocType,
  yearFromSourcePath,
} from "./axes";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import { MIN_DOC_TYPE_CONFIDENCE } from "@/lib/filing/tokens";

const derived = (over: Partial<Parameters<typeof deriveBrowseAxes>[0]> = {}) =>
  deriveBrowseAxes({
    extractedYear: null,
    engagementTaxYear: null,
    titleYear: null,
    dueDate: null,
    aiDocType: null,
    aiConfidence: null,
    ...over,
  });

describe("categories", () => {
  it("covers every group any doc type can actually have", () => {
    // If a new DocTypeGroup is added to doc-types.ts, the filter dropdown and
    // the Move picker must learn about it too — this is the tripwire.
    const used = new Set(
      Object.values(DOC_TYPE_LABELS).map((m) => m.group),
    );
    for (const g of used) expect(BROWSE_CATEGORIES).toContain(g);
  });

  it("rejects anything that is not a real group", () => {
    expect(isBrowseCategory("federal")).toBe(true);
    expect(isBrowseCategory("Unsorted")).toBe(false);
    expect(isBrowseCategory("")).toBe(false);
    expect(isBrowseCategory(null)).toBe(false);
  });

  it("maps a doc type to its group, and null to null", () => {
    expect(categoryForDocType("t4")).toBe("federal");
    expect(categoryForDocType(null)).toBeNull();
  });
});

describe("resolveDocType", () => {
  it("lets a human override the model outright", () => {
    const r = resolveDocType({
      manualDocType: "t4",
      aiDocType: "t5",
      aiConfidence: 0.99,
    });
    expect(r).toEqual({ code: "t4", manual: true });
  });

  it("does not confidence-check a human", () => {
    // There is no such thing as a low-confidence person. A manual type applies
    // whatever the model thought.
    expect(resolveDocType({ manualDocType: "t4", aiConfidence: 0 })).toEqual({
      code: "t4",
      manual: true,
    });
  });

  it("ignores a manual code that no longer exists", () => {
    // A doc type renamed out of the codebase must degrade to unknown, not crash
    // every page that renders the badge.
    expect(
      resolveDocType({ manualDocType: "t4_legacy_removed", aiDocType: null }),
    ).toEqual({ code: null, manual: false });
  });

  it("trusts the model only at or above the shared threshold", () => {
    const at = resolveDocType({
      aiDocType: "t4",
      aiConfidence: MIN_DOC_TYPE_CONFIDENCE,
    });
    const below = resolveDocType({
      aiDocType: "t4",
      aiConfidence: MIN_DOC_TYPE_CONFIDENCE - 0.01,
    });
    expect(at.code).toBe("t4");
    expect(below.code).toBeNull();
  });

  it("treats the model's escape hatches as not knowing", () => {
    expect(resolveDocType({ aiDocType: "unknown", aiConfidence: 1 }).code).toBeNull();
    expect(resolveDocType({ aiDocType: "other", aiConfidence: 1 }).code).toBeNull();
  });
});

describe("deriveBrowseAxes", () => {
  it("walks the year chain in the documented order", () => {
    expect(
      derived({
        extractedYear: 2024,
        engagementTaxYear: 2023,
        titleYear: 2022,
        dueDate: "2021-04-30",
      }).year,
    ).toBe(2024);
    expect(
      derived({ engagementTaxYear: 2023, titleYear: 2022, dueDate: "2021-04-30" })
        .year,
    ).toBe(2023);
    expect(derived({ titleYear: 2022, dueDate: "2021-04-30" }).year).toBe(2022);
    expect(derived({ dueDate: "2021-04-30" }).year).toBe(2021);
    expect(derived().year).toBeNull();
  });

  it("sends an unconfident classification to Unsorted, not to a wrong folder", () => {
    expect(derived({ aiDocType: "t4", aiConfidence: 0.95 }).category).toBe(
      "federal",
    );
    expect(derived({ aiDocType: "t4", aiConfidence: 0.2 }).category).toBeNull();
  });

  it("agrees with the filing engine about the same document", () => {
    // The contract this module exists to keep: what Browse shows and where the
    // file actually lands in the firm's Drive are one decision, not two.
    const axes = derived({ extractedYear: 2024, aiDocType: "t4", aiConfidence: 0.95 });
    expect(axes.year).toBe(2024);
    expect(axes.category).toBe(DOC_TYPE_LABELS.t4.group);
  });
});

describe("applyDerivedAxes — the never-undo-a-human invariant", () => {
  const stored = {
    browseYear: 2024,
    browseCategory: "federal",
    browseYearManual: false,
    browseCategoryManual: false,
  };

  it("updates both axes when nobody has claimed them", () => {
    expect(
      applyDerivedAxes(stored, { year: 2023, category: "quebec" }),
    ).toEqual({ browse_year: 2023, browse_category: "quebec" });
  });

  it("refuses to touch an axis a human set", () => {
    expect(
      applyDerivedAxes(
        { ...stored, browseYearManual: true },
        { year: 2023, category: "quebec" },
      ),
    ).toEqual({ browse_category: "quebec" });
  });

  it("protects each axis independently", () => {
    // Fixing the year by hand must not freeze the category as collateral.
    expect(
      applyDerivedAxes(
        { ...stored, browseCategoryManual: true },
        { year: 2023, category: "quebec" },
      ),
    ).toEqual({ browse_year: 2023 });
    expect(
      applyDerivedAxes(
        { ...stored, browseYearManual: true, browseCategoryManual: true },
        { year: 2023, category: "quebec" },
      ),
    ).toEqual({});
  });

  it("emits nothing when the derived answer already matches", () => {
    // A no-op re-classification must not write, so `updated_at`-style churn and
    // pointless row versions never happen.
    expect(
      applyDerivedAxes(stored, { year: 2024, category: "federal" }),
    ).toEqual({});
  });

  it("can clear an axis back to Unsorted", () => {
    expect(applyDerivedAxes(stored, { year: null, category: null })).toEqual({
      browse_year: null,
      browse_category: null,
    });
  });
});

describe("yearFromSourcePath", () => {
  it("reads the year a firm already has on disk", () => {
    expect(yearFromSourcePath("Tremblay Inc/2023/Slips/t4.pdf")).toBe(2023);
    expect(yearFromSourcePath("Tremblay Inc\\2023\\Slips\\t4.pdf")).toBe(2023);
  });

  it("prefers the deepest folder", () => {
    // "2019 archive/2023/..." — the inner folder is the specific one.
    expect(yearFromSourcePath("2019 archive/2023/t4.pdf")).toBe(2023);
  });

  it("skips an ambiguous segment and keeps looking outward", () => {
    expect(yearFromSourcePath("2021/T4 2023-2024/doc.pdf")).toBe(2021);
  });

  it("never guesses from two years alone", () => {
    expect(yearFromSourcePath("2020-2024 archive/doc.pdf")).toBeNull();
  });

  it("ignores the filename", () => {
    // Invoice and statement names are full of numbers that are not tax years;
    // being wrong here would be wrong across thousands of files at once.
    expect(yearFromSourcePath("Tremblay Inc/invoice-2023.pdf")).toBeNull();
  });

  it("handles paths with no folders and empty input", () => {
    expect(yearFromSourcePath("t4.pdf")).toBeNull();
    expect(yearFromSourcePath("")).toBeNull();
    expect(yearFromSourcePath(null)).toBeNull();
  });

  it("rejects a number that cannot be a filing year", () => {
    expect(yearFromSourcePath("1899/doc.pdf")).toBeNull();
    expect(yearFromSourcePath("2150/doc.pdf")).toBeNull();
  });
});
