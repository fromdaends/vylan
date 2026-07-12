import { describe, expect, it } from "vitest";
import { invoiceRunAfterMs, resolveInvoiceAmountCents } from "./resolve";

describe("resolveInvoiceAmountCents", () => {
  it("returns null when automation is off", () => {
    expect(
      resolveInvoiceAmountCents({
        mode: "off",
        useDefault: true,
        defaultCents: 45000,
        customAmount: "500",
      }),
    ).toBeNull();
  });

  it("uses the firm's saved default when chosen and present", () => {
    expect(
      resolveInvoiceAmountCents({
        mode: "on_completion",
        useDefault: true,
        defaultCents: 45000,
        customAmount: "",
      }),
    ).toBe(45000);
  });

  it("falls back to the custom amount when there is no default", () => {
    expect(
      resolveInvoiceAmountCents({
        mode: "on_completion",
        useDefault: true,
        defaultCents: null,
        customAmount: "123.45",
      }),
    ).toBe(12345);
  });

  it("parses a custom dollar amount to cents", () => {
    expect(
      resolveInvoiceAmountCents({
        mode: "delayed",
        useDefault: false,
        defaultCents: 45000,
        customAmount: "99.99",
      }),
    ).toBe(9999);
  });

  it("rejects an empty or below-minimum custom amount", () => {
    for (const bad of ["", "  ", "abc", "0", "0.49"]) {
      expect(
        resolveInvoiceAmountCents({
          mode: "on_completion",
          useDefault: false,
          defaultCents: null,
          customAmount: bad,
        }),
      ).toBeNull();
    }
  });

  it("accepts exactly the $0.50 Stripe floor", () => {
    expect(
      resolveInvoiceAmountCents({
        mode: "on_completion",
        useDefault: false,
        defaultCents: null,
        customAmount: "0.50",
      }),
    ).toBe(50);
  });
});

describe("invoiceRunAfterMs", () => {
  const base = Date.UTC(2026, 0, 10, 12, 0, 0); // fixed, no Date.now()

  it("adds whole days to the completion time", () => {
    expect(invoiceRunAfterMs(base, 7)).toBe(base + 7 * 86_400_000);
  });

  it("treats 0 days as fire-now (same instant)", () => {
    expect(invoiceRunAfterMs(base, 0)).toBe(base);
  });

  it("clamps negative / fractional days", () => {
    expect(invoiceRunAfterMs(base, -3)).toBe(base);
    expect(invoiceRunAfterMs(base, 2.9)).toBe(base + 2 * 86_400_000);
  });
});
