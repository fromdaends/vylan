import { describe, it, expect } from "vitest";
import {
  buildSagePreview,
  isSageExportable,
  type SageDocInput,
} from "./sage-export";

const doc = (over: Partial<SageDocInput>): SageDocInput => ({
  id: Math.random().toString(36).slice(2),
  name: "doc",
  expectedDocType: null,
  detectedType: null,
  hasTransaction: false,
  transactionConfidence: null,
  ...over,
});

describe("isSageExportable", () => {
  it("is true when the expected OR detected type is a receipt/invoice", () => {
    expect(isSageExportable("receipt", null)).toBe(true);
    expect(isSageExportable(null, "invoice")).toBe(true);
    expect(isSageExportable("other", "receipt")).toBe(true); // filed under 'other', read as a receipt
  });

  it("is false for statements, slips, reports, and unknowns", () => {
    expect(isSageExportable("bank_statement", "bank_statement")).toBe(false);
    expect(isSageExportable("t4", "t4")).toBe(false);
    expect(isSageExportable(null, "trial_balance")).toBe(false);
    expect(isSageExportable(null, null)).toBe(false);
  });
});

describe("buildSagePreview", () => {
  it("splits included vs skipped and groups skip reasons", () => {
    const p = buildSagePreview([
      doc({ detectedType: "receipt" }),
      doc({ expectedDocType: "invoice" }),
      doc({ detectedType: "bank_statement" }),
      doc({ detectedType: "t4" }),
      doc({ detectedType: "trial_balance" }),
    ]);
    expect(p.total).toBe(5);
    expect(p.includedCount).toBe(2);
    expect(p.skippedCount).toBe(3);
    // statement is called out on its own; the slip + report fall under "not_transaction"
    const reasons = Object.fromEntries(
      p.skippedByReason.map((r) => [r.reason, r.count]),
    );
    expect(reasons.statement).toBe(1);
    expect(reasons.not_transaction).toBe(2);
  });

  it("flags a low-confidence extraction on an included document", () => {
    const p = buildSagePreview([
      doc({ detectedType: "receipt", hasTransaction: true, transactionConfidence: 0.55 }),
      doc({ detectedType: "receipt", hasTransaction: true, transactionConfidence: 0.99 }),
    ]);
    expect(p.includedCount).toBe(2);
    expect(p.lowConfidenceCount).toBe(1);
    const flagged = p.docs.find(
      (d) => d.status === "included" && d.lowConfidence,
    );
    expect(flagged).toBeTruthy();
  });

  it("does not flag an included document that hasn't been read yet", () => {
    // No transaction data → not low-confidence (there's nothing to distrust yet).
    const p = buildSagePreview([
      doc({ detectedType: "invoice", hasTransaction: false, transactionConfidence: null }),
    ]);
    expect(p.includedCount).toBe(1);
    expect(p.lowConfidenceCount).toBe(0);
  });

  it("reports an all-skipped (statement-heavy) engagement as nothing to export", () => {
    const p = buildSagePreview([
      doc({ detectedType: "bank_statement" }),
      doc({ detectedType: "bank_statement" }),
    ]);
    expect(p.includedCount).toBe(0);
    expect(p.skippedCount).toBe(2);
  });

  it("handles an empty engagement", () => {
    const p = buildSagePreview([]);
    expect(p.total).toBe(0);
    expect(p.includedCount).toBe(0);
    expect(p.skippedByReason).toEqual([]);
  });
});
