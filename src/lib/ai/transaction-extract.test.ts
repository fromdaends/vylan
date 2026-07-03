import { describe, it, expect } from "vitest";
import {
  parseTransaction,
  shouldExtractTransaction,
  TRANSACTION_DOC_TYPES,
} from "./transaction-extract";

// A fully-populated, well-formed raw object as either provider would return it.
const rawGood: Record<string, unknown> = {
  direction: "expense",
  vendor_name: "Home Depot",
  customer_name: null,
  document_date: "2024-03-14",
  currency: "cad",
  subtotal: 100,
  total: 114.98,
  taxes: [
    { type: "GST", amount: 5, rate: 5 },
    { type: "QST", amount: 9.98, rate: 9.975 },
  ],
  confidence: 0.92,
  notes: null,
};

describe("shouldExtractTransaction", () => {
  it("runs when the EXPECTED type is a receipt or invoice", () => {
    expect(shouldExtractTransaction("receipt", "unknown")).toBe(true);
    expect(shouldExtractTransaction("invoice", "t4")).toBe(true);
  });

  it("runs when the DETECTED type is a receipt or invoice", () => {
    expect(shouldExtractTransaction("other", "receipt")).toBe(true);
    expect(shouldExtractTransaction("t4", "invoice")).toBe(true);
  });

  it("skips when neither expected nor detected is in scope", () => {
    expect(shouldExtractTransaction("t4", "t4")).toBe(false);
    expect(shouldExtractTransaction("bank_statement", "bank_statement")).toBe(
      false,
    );
    expect(shouldExtractTransaction("other", "unknown")).toBe(false);
  });

  it("handles null / undefined inputs", () => {
    expect(shouldExtractTransaction(null, null)).toBe(false);
    expect(shouldExtractTransaction(undefined, undefined)).toBe(false);
    expect(shouldExtractTransaction(null, "receipt")).toBe(true);
  });

  it("scopes to exactly receipt + invoice (no statements, no bills)", () => {
    expect([...TRANSACTION_DOC_TYPES].sort()).toEqual(["invoice", "receipt"]);
  });
});

describe("parseTransaction", () => {
  it("parses a clean expense receipt with two tax lines", () => {
    const t = parseTransaction(rawGood);
    expect(t).not.toBeNull();
    expect(t!.direction).toBe("expense");
    expect(t!.vendor_name).toBe("Home Depot");
    expect(t!.customer_name).toBeNull();
    expect(t!.document_date).toBe("2024-03-14");
    expect(t!.currency).toBe("CAD"); // upper-cased
    expect(t!.subtotal).toBe(100);
    expect(t!.total).toBe(114.98);
    expect(t!.taxes).toHaveLength(2);
    expect(t!.taxes[0]).toEqual({ type: "GST", amount: 5, rate: 5 });
    expect(t!.confidence).toBeCloseTo(0.92);
  });

  it("defaults an unknown/garbage direction to 'unknown'", () => {
    expect(
      parseTransaction({ ...rawGood, direction: "refund" })!.direction,
    ).toBe("unknown");
    expect(parseTransaction({ ...rawGood, direction: 7 })!.direction).toBe(
      "unknown",
    );
  });

  it("parses paid + payment_method, defaulting a non-boolean paid to null", () => {
    const paid = parseTransaction({
      ...rawGood,
      paid: true,
      payment_method: "Visa",
    });
    expect(paid!.paid).toBe(true);
    expect(paid!.payment_method).toBe("Visa");
    // Missing / non-boolean paid -> null; blank method -> null.
    expect(parseTransaction(rawGood)!.paid).toBeNull();
    expect(
      parseTransaction({ ...rawGood, paid: "yes", payment_method: "  " })!.paid,
    ).toBeNull();
    expect(
      parseTransaction({ ...rawGood, payment_method: "  " })!.payment_method,
    ).toBeNull();
  });

  it("keeps a valid income direction", () => {
    const t = parseTransaction({
      ...rawGood,
      direction: "income",
      vendor_name: null,
      customer_name: "Acme Inc.",
    });
    expect(t!.direction).toBe("income");
    expect(t!.customer_name).toBe("Acme Inc.");
  });

  it("clamps confidence into 0..1", () => {
    expect(parseTransaction({ ...rawGood, confidence: 1.7 })!.confidence).toBe(
      1,
    );
    expect(parseTransaction({ ...rawGood, confidence: -3 })!.confidence).toBe(
      0,
    );
    expect(
      parseTransaction({ ...rawGood, confidence: "high" })!.confidence,
    ).toBe(0);
  });

  it("nulls a non-ISO currency (symbol or word) and upper-cases a code", () => {
    expect(
      parseTransaction({ ...rawGood, currency: "$" })!.currency,
    ).toBeNull();
    expect(
      parseTransaction({ ...rawGood, currency: "dollars" })!.currency,
    ).toBeNull();
    expect(parseTransaction({ ...rawGood, currency: "usd" })!.currency).toBe(
      "USD",
    );
    expect(parseTransaction({ ...rawGood, currency: 42 })!.currency).toBeNull();
  });

  it("nulls non-finite amounts (NaN / Infinity / non-number)", () => {
    expect(parseTransaction({ ...rawGood, total: NaN })!.total).toBeNull();
    expect(
      parseTransaction({ ...rawGood, subtotal: Infinity })!.subtotal,
    ).toBeNull();
    expect(parseTransaction({ ...rawGood, total: "114.98" })!.total).toBeNull();
  });

  it("trims strings to null when blank", () => {
    const t = parseTransaction({
      ...rawGood,
      vendor_name: "   ",
      notes: "",
    });
    expect(t!.vendor_name).toBeNull();
    expect(t!.notes).toBeNull();
  });

  it("drops malformed tax lines and caps the list at 6", () => {
    const messy = {
      ...rawGood,
      taxes: [
        { type: "GST", amount: 5, rate: 5 }, // good
        { type: "QST", amount: "lots", rate: 9.975 }, // bad amount
        { type: "", amount: 1, rate: null }, // empty type
        { amount: 2 }, // no type
        "nonsense", // not an object
        { type: "PST", amount: 7, rate: null }, // good
      ],
    };
    const t = parseTransaction(messy);
    expect(t!.taxes).toEqual([
      { type: "GST", amount: 5, rate: 5 },
      { type: "PST", amount: 7, rate: null },
    ]);
  });

  it("returns an empty tax array when taxes is missing or not an array", () => {
    expect(parseTransaction({ ...rawGood, taxes: undefined })!.taxes).toEqual(
      [],
    );
    expect(parseTransaction({ ...rawGood, taxes: "GST 5" })!.taxes).toEqual([]);
  });

  it("nulls a missing rate but keeps the tax line", () => {
    const t = parseTransaction({
      ...rawGood,
      taxes: [{ type: "HST", amount: 13 }],
    });
    expect(t!.taxes).toEqual([{ type: "HST", amount: 13, rate: null }]);
  });

  it("parses line_items, dropping blanks / non-positive / malformed", () => {
    const t = parseTransaction({
      ...rawGood,
      line_items: [
        { description: "Drill", amount: 129 }, // good
        { description: "Tool bag", amount: 71 }, // good
        { description: "", amount: 5 }, // blank description
        { description: "Discount", amount: -10 }, // negative
        { description: "Zero", amount: 0 }, // zero
        { description: "Bad", amount: "lots" }, // non-number
        "nonsense", // not an object
      ],
    });
    expect(t!.line_items).toEqual([
      { description: "Drill", amount: 129 },
      { description: "Tool bag", amount: 71 },
    ]);
  });

  it("returns an empty line_items array when missing or not an array", () => {
    expect(parseTransaction(rawGood)!.line_items).toEqual([]);
    expect(
      parseTransaction({ ...rawGood, line_items: "nope" })!.line_items,
    ).toEqual([]);
  });
});
