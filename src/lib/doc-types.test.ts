import { describe, it, expect } from "vitest";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_GROUP_ORDER,
  DOC_TYPES,
  docTypesByGroup,
  docTypeLabel,
  docTypeGroupLabel,
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
