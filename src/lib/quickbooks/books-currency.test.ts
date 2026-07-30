import { describe, it, expect } from "vitest";
import { quickbooksBooksCurrency } from "./books-currency";

describe("quickbooksBooksCurrency — knowing the currency is not enough on QuickBooks", () => {
  it("reports the home currency when multicurrency is ON", () => {
    expect(
      quickbooksBooksCurrency({ homeCurrency: "CAD", multicurrencyEnabled: true }),
    ).toBe("CAD");
  });

  it("reports NOTHING when multicurrency is off, even though we know the currency", () => {
    // QuickBooks would refuse a CurrencyRef, so a foreign document must stay
    // blocked rather than post at face value in CAD.
    expect(
      quickbooksBooksCurrency({ homeCurrency: "CAD", multicurrencyEnabled: false }),
    ).toBeNull();
  });

  it("reports nothing when the preferences were never read", () => {
    expect(
      quickbooksBooksCurrency({ homeCurrency: null, multicurrencyEnabled: null }),
    ).toBeNull();
    expect(
      quickbooksBooksCurrency({ homeCurrency: "CAD", multicurrencyEnabled: null }),
    ).toBeNull();
  });

  it("normalises the code", () => {
    expect(
      quickbooksBooksCurrency({ homeCurrency: " cad ", multicurrencyEnabled: true }),
    ).toBe("CAD");
  });
});
