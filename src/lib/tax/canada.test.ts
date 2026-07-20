import { describe, it, expect } from "vitest";
import {
  PROVINCE_CODES,
  PROVINCE_TAXES,
  computeTaxLines,
  sumTaxCents,
  taxAmountCents,
  taxComponentLabel,
  formatRateMilliPct,
  provinceName,
  isProvinceCode,
} from "./canada";

describe("province → components map (the spec table)", () => {
  it("HST provinces bill one combined line at the current rate", () => {
    expect(PROVINCE_TAXES.ON).toEqual([
      { id: "HST", rateMilliPct: 13000, registrationKind: "gst" },
    ]);
    expect(PROVINCE_TAXES.NB[0].rateMilliPct).toBe(15000);
    expect(PROVINCE_TAXES.NL[0].rateMilliPct).toBe(15000);
    expect(PROVINCE_TAXES.PE[0].rateMilliPct).toBe(15000);
    // Nova Scotia dropped to 14% on 2025-04-01.
    expect(PROVINCE_TAXES.NS).toEqual([
      { id: "HST", rateMilliPct: 14000, registrationKind: "gst" },
    ]);
  });

  it("GST+PST provinces bill two lines", () => {
    expect(PROVINCE_TAXES.BC.map((c) => [c.id, c.rateMilliPct])).toEqual([
      ["GST", 5000],
      ["PST", 7000],
    ]);
    expect(PROVINCE_TAXES.SK.map((c) => [c.id, c.rateMilliPct])).toEqual([
      ["GST", 5000],
      ["PST", 6000],
    ]);
    expect(PROVINCE_TAXES.MB.map((c) => [c.id, c.rateMilliPct])).toEqual([
      ["GST", 5000],
      ["RST", 7000],
    ]);
  });

  it("Quebec bills GST 5% + QST 9.975%", () => {
    expect(PROVINCE_TAXES.QC.map((c) => [c.id, c.rateMilliPct])).toEqual([
      ["GST", 5000],
      ["QST", 9975],
    ]);
  });

  it("GST-only provinces and territories bill 5% only", () => {
    for (const code of ["AB", "NT", "NU", "YT"] as const) {
      expect(PROVINCE_TAXES[code]).toEqual([
        { id: "GST", rateMilliPct: 5000, registrationKind: "gst" },
      ]);
    }
  });

  it("covers all 13 provinces and territories, no more", () => {
    expect(Object.keys(PROVINCE_TAXES).sort()).toEqual(
      [...PROVINCE_CODES].sort(),
    );
    expect(PROVINCE_CODES).toHaveLength(13);
  });

  it("HST shares the GST registration; QST and PST/RST have their own kinds", () => {
    expect(PROVINCE_TAXES.ON[0].registrationKind).toBe("gst");
    expect(PROVINCE_TAXES.QC[1].registrationKind).toBe("qst");
    expect(PROVINCE_TAXES.BC[1].registrationKind).toBe("pst");
    expect(PROVINCE_TAXES.MB[1].registrationKind).toBe("pst");
  });
});

describe("computeTaxLines — everything on the subtotal, cent rounding per line", () => {
  it("Quebec: BOTH components on the subtotal (QST not compounded on GST)", () => {
    const lines = computeTaxLines(10000, "QC"); // $100.00
    expect(lines).toEqual([
      {
        component: "GST",
        rateMilliPct: 5000,
        registrationKind: "gst",
        baseCents: 10000,
        amountCents: 500, // $5.00
      },
      {
        component: "QST",
        rateMilliPct: 9975,
        registrationKind: "qst",
        baseCents: 10000, // the SUBTOTAL — not 10500
        amountCents: 998, // round(997.5) = $9.98
      },
    ]);
    expect(sumTaxCents(lines)).toBe(1498);
  });

  it("rounds half-up per component ($9.99 subtotal in QC)", () => {
    const lines = computeTaxLines(999, "QC");
    // GST: 999 * 5% = 49.95 → 50 · QST: 999 * 9.975% = 99.65 → 100
    expect(lines.map((l) => l.amountCents)).toEqual([50, 100]);
  });

  it("Ontario: a single 13% HST line", () => {
    const lines = computeTaxLines(20000, "ON");
    expect(lines).toEqual([
      {
        component: "HST",
        rateMilliPct: 13000,
        registrationKind: "gst",
        baseCents: 20000,
        amountCents: 2600,
      },
    ]);
  });

  it("Nova Scotia: 14%", () => {
    expect(computeTaxLines(10000, "NS")[0].amountCents).toBe(1400);
  });

  it("BC: GST + PST as two lines; toggling PST off leaves GST only", () => {
    const all = computeTaxLines(10000, "BC");
    expect(all.map((l) => [l.component, l.amountCents])).toEqual([
      ["GST", 500],
      ["PST", 700],
    ]);
    const gstOnly = computeTaxLines(10000, "BC", (id) => id !== "PST");
    expect(gstOnly.map((l) => l.component)).toEqual(["GST"]);
    expect(sumTaxCents(gstOnly)).toBe(500);
  });

  it("Alberta: GST only", () => {
    const lines = computeTaxLines(12345, "AB");
    expect(lines).toHaveLength(1);
    expect(lines[0].amountCents).toBe(617); // round(617.25)
  });

  it("all components disabled → zero tax lines", () => {
    expect(computeTaxLines(10000, "QC", () => false)).toEqual([]);
  });

  it("taxAmountCents stays exact on large amounts (no float drift)", () => {
    // $999,999.99 at 9.975%: 99999999 * 9975 / 100000 = 9974999.900…
    expect(taxAmountCents(99_999_999, 9975)).toBe(9_975_000);
    // Stripe-max invoice at 15%.
    expect(taxAmountCents(99_999_999, 15000)).toBe(15_000_000);
  });
});

describe("labels", () => {
  it("renders bilingual component labels with the rate", () => {
    expect(taxComponentLabel({ id: "GST", rateMilliPct: 5000 }, "en")).toBe(
      "GST (5%)",
    );
    expect(taxComponentLabel({ id: "GST", rateMilliPct: 5000 }, "fr")).toBe(
      "TPS (5 %)",
    );
    expect(taxComponentLabel({ id: "QST", rateMilliPct: 9975 }, "en")).toBe(
      "QST (9.975%)",
    );
    expect(taxComponentLabel({ id: "QST", rateMilliPct: 9975 }, "fr")).toBe(
      "TVQ (9,975 %)",
    );
    expect(taxComponentLabel({ id: "HST", rateMilliPct: 13000 }, "fr")).toBe(
      "TVH (13 %)",
    );
  });

  it("formats fractional and whole rates", () => {
    expect(formatRateMilliPct(5000, "en")).toBe("5");
    expect(formatRateMilliPct(9975, "en")).toBe("9.975");
    expect(formatRateMilliPct(9975, "fr")).toBe("9,975");
    expect(formatRateMilliPct(14000, "en")).toBe("14");
  });

  it("names provinces in both languages", () => {
    expect(provinceName("QC", "en")).toBe("Quebec");
    expect(provinceName("QC", "fr")).toBe("Québec");
    expect(provinceName("NL", "fr")).toBe("Terre-Neuve-et-Labrador");
  });

  it("isProvinceCode guards untrusted input", () => {
    expect(isProvinceCode("QC")).toBe(true);
    expect(isProvinceCode("XX")).toBe(false);
    expect(isProvinceCode(null)).toBe(false);
  });
});
