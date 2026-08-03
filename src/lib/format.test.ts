import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatCurrency,
  formatNumber,
  formatBytes,
  formatRelative,
} from "./format";

describe("formatDate", () => {
  it("renders Postgres YYYY-MM-DD strings without timezone drift", () => {
    expect(formatDate("2026-04-30", "fr")).toBe("30 avril 2026");
    expect(formatDate("2026-04-30", "en")).toBe("April 30, 2026");
  });

  it("supports short and long styles", () => {
    const fr = formatDate("2026-04-30", "fr", "short");
    expect(fr).toMatch(/2026/);
    const long = formatDate("2026-04-30", "en", "long");
    expect(long).toContain("Thursday");
  });

  it("returns em-dash for nullish input", () => {
    expect(formatDate(null, "fr")).toBe("—");
    expect(formatDate(undefined, "en")).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("uses French Canadian conventions (suffix sign, comma decimal)", () => {
    const out = formatCurrency(1234.56, "fr");
    // FR-CA: "1 234,56 $" (with a non-breaking space before $)
    expect(out).toMatch(/1\s?234,56/);
    expect(out).toContain("$");
  });

  it("uses English Canadian conventions ($ prefix, dot decimal)", () => {
    expect(formatCurrency(1234.56, "en")).toBe("$1,234.56");
  });

  it("returns em-dash for nullish or non-finite input", () => {
    expect(formatCurrency(null, "fr")).toBe("—");
    expect(formatCurrency(undefined, "en")).toBe("—");
    expect(formatCurrency(Number.NaN, "en")).toBe("—");
  });

  // THE REGRESSION. This hardcoded CAD, so every amount in the app rendered
  // with a Canadian dollar sign regardless of what it was actually denominated
  // in — including the ledger of a Xero organisation that banks in USD.
  it("formats in the currency it is given", () => {
    expect(formatCurrency(1234.56, "en", { currency: "USD" })).toBe(
      "US$1,234.56",
    );
    expect(formatCurrency(1234.56, "en", { currency: "EUR" })).toBe(
      "€1,234.56",
    );
    // French names the foreign currency rather than symbolising it, which is
    // the behaviour we want: no bare "$" that could mean either dollar.
    expect(formatCurrency(1234.56, "fr", { currency: "USD" })).toMatch(/US/);
  });

  it("still defaults to CAD when no currency is given", () => {
    // Billing, plans and invoices are genuinely CAD and pass nothing.
    expect(formatCurrency(1234.56, "en")).toBe("$1,234.56");
    expect(formatCurrency(1234.56, "en", {})).toBe("$1,234.56");
  });

  it("treats a missing or blank currency as the firm's own", () => {
    // Ledger rows often have no currency recorded. That is not a reason to
    // refuse to render, and it is not a reason to guess something foreign.
    expect(formatCurrency(1234.56, "en", { currency: null })).toBe("$1,234.56");
    expect(formatCurrency(1234.56, "en", { currency: "   " })).toBe(
      "$1,234.56",
    );
  });

  it("keeps the old numeric third argument working", () => {
    // ~7 call sites pass a digit count positionally (plan prices use 0).
    expect(formatCurrency(1234.56, "en", 0)).toBe("$1,235");
    expect(formatCurrency(1234.5, "en", 2)).toBe("$1,234.50");
  });

  it("takes digits and currency together", () => {
    expect(formatCurrency(1234.56, "en", { fractionDigits: 0, currency: "USD" }))
      .toBe("US$1,235");
  });
});

describe("formatNumber", () => {
  it("groups thousands per locale", () => {
    const fr = formatNumber(1234567, "fr");
    expect(fr).toMatch(/1\s?234\s?567/);
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });
});

describe("formatBytes", () => {
  it("renders KB / MB / B as appropriate", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("handles null and non-finite gracefully", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-05-15T12:00:00Z");

  it("renders just-now within a minute", () => {
    expect(formatRelative(new Date(now.getTime() - 30_000), "fr", now)).toBe(
      "à l'instant",
    );
  });

  it("uses minutes / hours / days appropriately", () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    expect(formatRelative(fiveMinAgo, "en", now)).toMatch(/5 minutes ago/);
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);
    expect(formatRelative(twoHoursAgo, "en", now)).toMatch(/2 hours ago/);
    const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000);
    expect(formatRelative(threeDaysAgo, "en", now)).toMatch(/3 days ago/);
  });
});
