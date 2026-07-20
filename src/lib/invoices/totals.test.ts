import { describe, it, expect } from "vitest";
import {
  computeLineAmountCents,
  normalizeLineItems,
  computeInvoiceTotals,
  parseStoredLineItems,
  parseStoredTaxLines,
  MAX_LINE_ITEMS,
} from "./totals";

const LINE = (desc: string, qty: number, unit: number) => ({
  description: desc,
  quantity: qty,
  unit_cents: unit,
});

describe("computeLineAmountCents", () => {
  it("rounds fractional quantities to the cent", () => {
    expect(computeLineAmountCents(1, 15000)).toBe(15000);
    expect(computeLineAmountCents(1.5, 15000)).toBe(22500);
    // 1.333 hours at $150.00 = $199.95
    expect(computeLineAmountCents(1.333, 15000)).toBe(19995);
    // 0.333 * 100.01 = 33.30333 → 3330 cents
    expect(computeLineAmountCents(0.333, 10001)).toBe(3330);
  });
});

describe("normalizeLineItems", () => {
  it("freezes computed amounts and trims descriptions", () => {
    const lines = normalizeLineItems([
      { ...LINE("  Personal return (T1)  ", 1, 20000) },
      { ...LINE("Hours", 2.5, 10000) },
    ]);
    expect(lines).toEqual([
      {
        description: "Personal return (T1)",
        quantity: 1,
        unit_cents: 20000,
        amount_cents: 20000,
      },
      { description: "Hours", quantity: 2.5, unit_cents: 10000, amount_cents: 25000 },
    ]);
  });

  it("ignores client-supplied amount_cents (tamper-proofing)", () => {
    const lines = normalizeLineItems([
      { ...LINE("X", 1, 10000), amount_cents: 1 },
    ]);
    expect(lines?.[0].amount_cents).toBe(10000);
  });

  it("rejects empty, oversized, and out-of-bounds payloads", () => {
    expect(normalizeLineItems([])).toBeNull();
    expect(normalizeLineItems("nope")).toBeNull();
    expect(
      normalizeLineItems(
        Array.from({ length: MAX_LINE_ITEMS + 1 }, () => LINE("x", 1, 100)),
      ),
    ).toBeNull();
    expect(normalizeLineItems([LINE("x".repeat(301), 1, 100)])).toBeNull();
    expect(normalizeLineItems([LINE("x", 0, 100)])).toBeNull();
    expect(normalizeLineItems([LINE("x", -1, 100)])).toBeNull();
    expect(normalizeLineItems([LINE("x", 10000, 100)])).toBeNull();
    // more than 3 decimals
    expect(normalizeLineItems([LINE("x", 1.0001, 100)])).toBeNull();
    // non-integer / negative unit cents
    expect(normalizeLineItems([LINE("x", 1, 100.5)])).toBeNull();
    expect(normalizeLineItems([LINE("x", 1, -1)])).toBeNull();
  });

  it("allows a zero-priced line (comped item on a larger invoice)", () => {
    const lines = normalizeLineItems([LINE("Comped", 1, 0)]);
    expect(lines?.[0].amount_cents).toBe(0);
  });

  it("allows an empty description (the field is optional, like the flat invoice)", () => {
    const lines = normalizeLineItems([LINE("", 1, 10000)]);
    expect(lines).toEqual([
      { description: "", quantity: 1, unit_cents: 10000, amount_cents: 10000 },
    ]);
  });
});

describe("computeInvoiceTotals", () => {
  const LINES = [
    { description: "T1", quantity: 1, unit_cents: 20000, amount_cents: 20000 },
    { description: "Hrs", quantity: 2, unit_cents: 5000, amount_cents: 10000 },
  ];

  it("Quebec: GST + QST both on the subtotal, registration numbers frozen", () => {
    const c = computeInvoiceTotals(LINES, {
      province: "QC",
      taxesEnabled: true,
      enabledComponents: null,
      registrationNumbers: { gst: "123456789 RT0001", qst: "111 TQ0001" },
    });
    expect(c.subtotalCents).toBe(30000);
    expect(c.taxLines).toEqual([
      {
        component: "GST",
        rate_milli_pct: 5000,
        registration_kind: "gst",
        base_cents: 30000,
        amount_cents: 1500,
        registration_number: "123456789 RT0001",
      },
      {
        component: "QST",
        rate_milli_pct: 9975,
        registration_kind: "qst",
        base_cents: 30000,
        amount_cents: 2993, // round(2992.5)
        registration_number: "111 TQ0001",
      },
    ]);
    expect(c.taxTotalCents).toBe(4493);
    expect(c.totalCents).toBe(34493);
  });

  it("component toggle: BC with PST off leaves GST only", () => {
    const c = computeInvoiceTotals(LINES, {
      province: "BC",
      taxesEnabled: true,
      enabledComponents: ["GST"],
    });
    expect(c.taxLines.map((l) => l.component)).toEqual(["GST"]);
    expect(c.totalCents).toBe(31500);
  });

  it("master toggle off → subtotal is the total", () => {
    const c = computeInvoiceTotals(LINES, {
      province: "QC",
      taxesEnabled: false,
      enabledComponents: null,
    });
    expect(c.taxLines).toEqual([]);
    expect(c.totalCents).toBe(30000);
  });

  it("no province (firm without invoice settings) → no taxes ever", () => {
    const c = computeInvoiceTotals(LINES, {
      province: null,
      taxesEnabled: true,
      enabledComponents: null,
    });
    expect(c.taxLines).toEqual([]);
    expect(c.totalCents).toBe(30000);
  });

  it("missing registration numbers freeze as null", () => {
    const c = computeInvoiceTotals(LINES, {
      province: "ON",
      taxesEnabled: true,
      enabledComponents: null,
      registrationNumbers: { gst: "  " },
    });
    expect(c.taxLines[0].registration_number).toBeNull();
  });
});

describe("stored-value parsers", () => {
  it("round-trips computed values", () => {
    const c = computeInvoiceTotals(
      [{ description: "X", quantity: 1, unit_cents: 100, amount_cents: 100 }],
      { province: "QC", taxesEnabled: true, enabledComponents: null },
    );
    expect(parseStoredLineItems(JSON.parse(JSON.stringify(c.lineItems)))).toEqual(
      c.lineItems,
    );
    expect(parseStoredTaxLines(JSON.parse(JSON.stringify(c.taxLines)))).toEqual(
      c.taxLines,
    );
  });

  it("filters malformed rows instead of crashing", () => {
    expect(parseStoredLineItems(null)).toEqual([]);
    expect(parseStoredLineItems([{ bogus: true }, null])).toEqual([]);
    expect(parseStoredTaxLines("x")).toEqual([]);
  });
});
