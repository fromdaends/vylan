import { describe, expect, it } from "vitest";
import { snapshotFromRequestItems } from "./snapshot";

const base = {
  label: "Bank statement",
  label_fr: "Relevé bancaire",
  description: "All accounts",
  description_fr: "Tous les comptes",
  doc_type: "bank_statement" as const,
  required: true,
  kind: "collection" as const,
};

describe("snapshotFromRequestItems", () => {
  it("maps request items to the template item shape", () => {
    expect(snapshotFromRequestItems([base])).toEqual([
      {
        label_en: "Bank statement",
        label_fr: "Relevé bancaire",
        description_en: "All accounts",
        description_fr: "Tous les comptes",
        doc_type: "bank_statement",
        required: true,
      },
    ]);
  });

  it("excludes signature items — future occurrences can't reuse a per-engagement signing doc", () => {
    const snapshot = snapshotFromRequestItems([
      base,
      { ...base, label: "Engagement letter", kind: "signature" },
    ]);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].label_en).toBe("Bank statement");
  });

  it("falls back across languages so single-language items survive", () => {
    const snapshot = snapshotFromRequestItems([
      { ...base, label: "", description: null },
    ]);
    expect(snapshot[0].label_en).toBe("Relevé bancaire");
    expect(snapshot[0].description_en).toBe("Tous les comptes");
  });

  it("drops items with no label in either language", () => {
    expect(
      snapshotFromRequestItems([{ ...base, label: "", label_fr: "" }]),
    ).toEqual([]);
  });
});
