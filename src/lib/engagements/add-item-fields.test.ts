import { describe, it, expect } from "vitest";
import { pickAddItemFields } from "./add-item-fields";

// Version-proof: whatever field names a cached client bundle posts, the action
// must find the label + description. This is the guard that ends the
// add-item deploy-skew saga.
describe("pickAddItemFields", () => {
  it("reads the current single label/description", () => {
    expect(
      pickAddItemFields({ label: "T4", description: "All your T4s" }),
    ).toEqual({ label: "T4", description: "All your T4s" });
  });

  it("reads the legacy label_fr/label_en + description_fr (old client)", () => {
    expect(
      pickAddItemFields({
        label_fr: "Relevé",
        label_en: "Slip",
        description_fr: "desc",
      }),
    ).toEqual({ label: "Relevé", description: "desc" });
  });

  it("prefers the new `label` when both are present (bridge client)", () => {
    expect(
      pickAddItemFields({ label: "T4", label_fr: "T4", label_en: "T4" }),
    ).toEqual({ label: "T4", description: null });
  });

  it("trims and treats blank/whitespace as empty (caller rejects)", () => {
    expect(pickAddItemFields({ label: "  Bank  " }).label).toBe("Bank");
    expect(pickAddItemFields({ label: "   " }).label).toBe("");
    expect(pickAddItemFields({}).label).toBe("");
    expect(pickAddItemFields({ description: "" }).description).toBeNull();
  });
});
