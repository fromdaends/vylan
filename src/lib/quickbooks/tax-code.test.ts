import { describe, it, expect } from "vitest";
import { isAdjustmentTaxCode, isSelectableTaxCode } from "./tax-code";

describe("isAdjustmentTaxCode", () => {
  it("flags QuickBooks adjustment codes (EN + FR)", () => {
    expect(isAdjustmentTaxCode("GST/HST Adjustment")).toBe(true);
    expect(isAdjustmentTaxCode("QST Adjustment")).toBe(true);
    expect(isAdjustmentTaxCode("Ajustement de la TPS/TVH")).toBe(true);
    expect(isAdjustmentTaxCode("ADJUSTMENT")).toBe(true);
  });

  it("does NOT flag normal purchasable / valid codes", () => {
    for (const name of [
      "GST/HST ON 13%",
      "GST 5%",
      "QST 9.975%",
      "GST/QST QC - 5%/9.975%",
      "Exempt",
      "Zero-rated",
      "Out of scope",
      "HST BC 12%",
    ]) {
      expect(isAdjustmentTaxCode(name)).toBe(false);
      expect(isSelectableTaxCode(name)).toBe(true);
    }
  });

  it("isSelectableTaxCode is the inverse", () => {
    expect(isSelectableTaxCode("GST/HST Adjustment")).toBe(false);
    expect(isSelectableTaxCode("GST 5%")).toBe(true);
  });
});
