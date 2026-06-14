import { describe, it, expect } from "vitest";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_GROUP_ORDER,
  DOC_TYPES,
  docTypesByGroup,
  docTypeLabel,
  docTypeGroupLabel,
  appliesToProvince,
} from "./doc-types";
import type { DocType } from "./db/templates";

describe("DOC_TYPE_LABELS", () => {
  it("gives every code a non-empty EN + FR label, a known group, and an AI description", () => {
    for (const [code, meta] of Object.entries(DOC_TYPE_LABELS)) {
      expect(meta.en, `${code}.en`).toBeTruthy();
      expect(meta.fr, `${code}.fr`).toBeTruthy();
      expect(meta.ai, `${code}.ai`).toBeTruthy();
      expect(DOC_TYPE_GROUP_ORDER, `${code}.group`).toContain(meta.group);
    }
  });

  it("includes the newly-added Quebec + federal documents", () => {
    const codes = Object.keys(DOC_TYPE_LABELS);
    for (const c of [
      "t4a", "t4a_oas", "t4a_p", "t4e", "t4rsp", "t4rif", "fhsa",
      "t5008", "t5013", "nr4", "t2200", "t2091", "t2201",
      "rl2", "rl5", "rl6", "rl8", "rl15", "rl18", "rl24", "rl31", "rl32",
    ]) {
      expect(codes, `missing ${c}`).toContain(c);
    }
  });

  it("uses the corrected T4 French name, not the ROE 'Relevé d'emploi'", () => {
    expect(DOC_TYPE_LABELS.t4.fr).toBe("T4 — État de la rémunération payée");
    expect(DOC_TYPE_LABELS.t4.fr).not.toContain("Relevé d'emploi");
  });

  it("groups RL slips under quebec and T-slips under federal", () => {
    expect(DOC_TYPE_LABELS.rl31.group).toBe("quebec");
    expect(DOC_TYPE_LABELS.rl1.group).toBe("quebec");
    expect(DOC_TYPE_LABELS.t4.group).toBe("federal");
  });
});

describe("docTypesByGroup", () => {
  it("covers every code exactly once", () => {
    const grouped = docTypesByGroup().flatMap((g) => g.codes);
    expect([...grouped].sort()).toEqual(
      (Object.keys(DOC_TYPE_LABELS) as DocType[]).sort(),
    );
    expect(new Set(grouped).size).toBe(grouped.length); // no duplicates
  });

  it("orders the groups per DOC_TYPE_GROUP_ORDER", () => {
    const groups = docTypesByGroup().map((g) => g.group);
    expect(groups).toEqual(
      DOC_TYPE_GROUP_ORDER.filter((g) => groups.includes(g)),
    );
  });

  it("DOC_TYPES is the full code list", () => {
    expect([...DOC_TYPES].sort()).toEqual(
      (Object.keys(DOC_TYPE_LABELS) as DocType[]).sort(),
    );
  });
});

describe("docTypeLabel / docTypeGroupLabel", () => {
  it("returns FR for 'fr' and EN for anything else", () => {
    expect(docTypeLabel("t5", "fr")).toBe(DOC_TYPE_LABELS.t5.fr);
    expect(docTypeLabel("t5", "en")).toBe(DOC_TYPE_LABELS.t5.en);
    expect(docTypeLabel("t5", "de")).toBe(DOC_TYPE_LABELS.t5.en);
  });

  it("has a label for every group in both languages", () => {
    for (const g of DOC_TYPE_GROUP_ORDER) {
      expect(docTypeGroupLabel(g, "en")).toBeTruthy();
      expect(docTypeGroupLabel(g, "fr")).toBeTruthy();
    }
  });
});

describe("appliesToProvince (province-aware document filtering)", () => {
  it("hides Quebec RL slips for a non-Quebec province", () => {
    expect(appliesToProvince("rl1", "ON")).toBe(false);
    expect(appliesToProvince("rl3", "BC")).toBe(false);
    expect(appliesToProvince("rl31", "AB")).toBe(false);
  });

  it("keeps Quebec RL slips for a Quebec client", () => {
    expect(appliesToProvince("rl1", "QC")).toBe(true);
    expect(appliesToProvince("rl31", "QC")).toBe(true);
  });

  it("keeps federal slips and national docs everywhere", () => {
    for (const p of ["ON", "QC", "BC", "AB", "NS"]) {
      expect(appliesToProvince("t4", p)).toBe(true);
      expect(appliesToProvince("t5", p)).toBe(true);
      expect(appliesToProvince("medical", p)).toBe(true);
      expect(appliesToProvince("noa", p)).toBe(true);
    }
  });

  it("shows everything when the province is not set (no regression)", () => {
    expect(appliesToProvince("rl1", null)).toBe(true);
    expect(appliesToProvince("rl1", undefined)).toBe(true);
    expect(appliesToProvince("rl1", "")).toBe(true);
  });

  it("docTypesByGroup(province) drops the whole quebec group for Ontario", () => {
    const on = docTypesByGroup("ON");
    expect(on.some((g) => g.group === "quebec")).toBe(false);
    expect(on.some((g) => g.group === "federal")).toBe(true);

    const qc = docTypesByGroup("QC");
    expect(qc.some((g) => g.group === "quebec")).toBe(true);

    // Unfiltered keeps Quebec (existing callers unchanged).
    expect(docTypesByGroup().some((g) => g.group === "quebec")).toBe(true);
  });
});

describe("appliesToProvince (firm-wide Quebec off-switch, migration 0350)", () => {
  it("hides the Quebec RL slips for any province when the firm excludes them", () => {
    // Even a Quebec client of a firm that turned Quebec forms off.
    expect(appliesToProvince("rl1", "QC", false)).toBe(false);
    expect(appliesToProvince("rl3", "QC", false)).toBe(false);
    expect(appliesToProvince("rl1", null, false)).toBe(false);
    expect(appliesToProvince("rl31", "ON", false)).toBe(false);
  });

  it("never hides non-Quebec forms when the firm excludes Quebec", () => {
    expect(appliesToProvince("t4", "QC", false)).toBe(true);
    expect(appliesToProvince("noa", null, false)).toBe(true);
    expect(appliesToProvince("gst_hst_qst", "ON", false)).toBe(true);
  });

  it("defaults to including Quebec (today's per-client behaviour preserved)", () => {
    expect(appliesToProvince("rl1", "QC")).toBe(true);
    expect(appliesToProvince("rl1", "QC", true)).toBe(true);
    expect(appliesToProvince("rl1", "ON", true)).toBe(false);
  });

  it("docTypesByGroup drops the quebec group when the firm excludes it, even for QC", () => {
    const off = docTypesByGroup("QC", false);
    expect(off.some((g) => g.group === "quebec")).toBe(false);
    expect(off.some((g) => g.group === "federal")).toBe(true);
    // On (default) keeps Quebec for a QC client.
    expect(docTypesByGroup("QC", true).some((g) => g.group === "quebec")).toBe(
      true,
    );
  });
});
