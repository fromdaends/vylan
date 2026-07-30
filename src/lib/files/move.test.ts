import { describe, expect, it } from "vitest";
import { buildMovePatch } from "./move";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";

describe("buildMovePatch", () => {
  it("writes a year and marks it as a human's decision", () => {
    const r = buildMovePatch("checklist", { year: "2023" });
    expect(r).toEqual({
      ok: true,
      patch: { browse_year: 2023, browse_year_manual: true },
    });
  });

  it("treats Unsorted as a real destination, not as 'no change'", () => {
    const r = buildMovePatch("checklist", { year: "unsorted", category: "unsorted" });
    expect(r.ok && r.patch).toEqual({
      browse_year: null,
      browse_year_manual: true,
      browse_category: null,
      browse_category_manual: true,
    });
  });

  it("lets a document type fill in the folder it implies", () => {
    const r = buildMovePatch("checklist", { docType: "t4" });
    expect(r.ok && r.patch.manual_doc_type).toBe("t4");
    expect(r.ok && r.patch.browse_category).toBe(DOC_TYPE_LABELS.t4.group);
    expect(r.ok && r.patch.browse_category_manual).toBe(true);
  });

  it("lets an explicit folder override the one the type implies", () => {
    // A firm that files T4s somewhere else must not be overruled by the
    // convention.
    const r = buildMovePatch("checklist", { docType: "t4", category: "bookkeeping" });
    expect(r.ok && r.patch.manual_doc_type).toBe("t4");
    expect(r.ok && r.patch.browse_category).toBe("bookkeeping");
  });

  it("can clear a hand-set type", () => {
    const r = buildMovePatch("checklist", { docType: "none" });
    expect(r).toEqual({ ok: true, patch: { manual_doc_type: null } });
  });

  it("never writes the manual flags for an imported document", () => {
    // 1070 gave imported_documents no such columns; writing them would make
    // every move of an imported file fail — and imports are the files that most
    // need moving, since they arrive unsorted on purpose.
    const r = buildMovePatch("imported", { year: "2023", category: "federal" });
    expect(r.ok && r.patch).toEqual({
      browse_year: 2023,
      browse_category: "federal",
    });
    expect(r.ok && "browse_year_manual" in r.patch).toBe(false);
    expect(r.ok && "browse_category_manual" in r.patch).toBe(false);
  });

  it("does write the manual flags for deliverables", () => {
    const r = buildMovePatch("final", { year: "2023" });
    expect(r.ok && r.patch.browse_year_manual).toBe(true);
  });

  it("leaves untouched axes out of the patch entirely", () => {
    // Moving only the year must not blank the category as a side effect.
    const r = buildMovePatch("checklist", { year: "2023" });
    expect(r.ok && "browse_category" in r.patch).toBe(false);
    expect(r.ok && "manual_doc_type" in r.patch).toBe(false);
  });

  it("rejects nonsense rather than writing it", () => {
    expect(buildMovePatch("checklist", { year: "1200" }).ok).toBe(false);
    expect(buildMovePatch("checklist", { year: "3000" }).ok).toBe(false);
    expect(buildMovePatch("checklist", { year: "abc" }).ok).toBe(false);
    expect(buildMovePatch("checklist", { category: "not_a_folder" }).ok).toBe(false);
    expect(buildMovePatch("checklist", { docType: "not_a_type" }).ok).toBe(false);
  });

  it("refuses an empty move instead of issuing a no-op UPDATE", () => {
    expect(buildMovePatch("checklist", {})).toEqual({
      ok: false,
      reason: "nothing_to_do",
    });
    expect(buildMovePatch("checklist", { year: "", category: "" }).ok).toBe(false);
  });
});
