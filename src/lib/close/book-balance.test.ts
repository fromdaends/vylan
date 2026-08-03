import { describe, it, expect } from "vitest";
import {
  toCents,
  parseXeroBankSummary,
  parseQuickbooksBalances,
} from "./book-balance";

describe("toCents", () => {
  it("converts the decimal strings both ledgers send", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("-89")).toBe(-8900);
    expect(toCents("1,234.56")).toBe(123456);
    expect(toCents("0")).toBe(0);
    expect(toCents(42.5)).toBe(4250);
  });

  it("reads accounting parentheses as negative", () => {
    expect(toCents("(240.15)")).toBe(-24015);
  });

  it("refuses anything that is not a number — never coerces to 0", () => {
    // The whole point: a 0 here would become a confident wrong balance.
    for (const junk of ["", "  ", "n/a", "—", null, undefined, {}, [], NaN]) {
      expect(toCents(junk)).toBeNull();
    }
  });

  it("rounds to the cent rather than carrying a float", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("19.99")).toBe(1999);
    // 1.005 * 100 is 100.49999... in binary floating point.
    expect(toCents("1.005")).toBe(100);
  });
});

describe("parseXeroBankSummary", () => {
  // Shape per Xero's BankSummary: name cell carries accountID in Attributes,
  // closing balance is the last cell.
  const report = {
    Rows: [
      { RowType: "Header", Cells: [{ Value: "Bank Accounts" }] },
      {
        RowType: "Section",
        Rows: [
          {
            RowType: "Row",
            Cells: [
              {
                Value: "Business Chequing",
                Attributes: [{ Id: "accountID", Value: "acc-1" }],
              },
              { Value: "1000.00" },
              { Value: "500.00" },
              { Value: "200.00" },
              { Value: "1300.00" },
            ],
          },
          {
            RowType: "Row",
            Cells: [
              {
                Value: "Visa",
                Attributes: [{ Id: "accountID", Value: "acc-2" }],
              },
              { Value: "-500.00" },
              { Value: "0.00" },
              { Value: "240.15" },
              { Value: "-740.15" },
            ],
          },
        ],
      },
    ],
  };

  it("reads the CLOSING balance per account, with its id", () => {
    const rows = parseXeroBankSummary(report);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      accountId: "acc-1",
      name: "Business Chequing",
      balanceCents: 130000,
    });
    // Negative closing balance survives — a credit card owes money.
    expect(rows[1]).toMatchObject({ accountId: "acc-2", balanceCents: -74015 });
  });

  it("labels credit cards from the cached chart of accounts", () => {
    const rows = parseXeroBankSummary(
      report,
      new Map([["acc-2", "credit_card" as const]]),
    );
    expect(rows.find((r) => r.accountId === "acc-2")!.kind).toBe("credit_card");
    expect(rows.find((r) => r.accountId === "acc-1")!.kind).toBe("bank");
  });

  it("skips header rows and anything with no account id", () => {
    expect(
      parseXeroBankSummary({
        Rows: [
          { RowType: "Header", Cells: [{ Value: "Bank Accounts" }] },
          { RowType: "Row", Cells: [{ Value: "Total" }, { Value: "99.00" }] },
        ],
      }),
    ).toEqual([]);
  });

  it("survives an empty or malformed report instead of throwing", () => {
    expect(parseXeroBankSummary(undefined)).toEqual([]);
    expect(parseXeroBankSummary(null)).toEqual([]);
    expect(parseXeroBankSummary({})).toEqual([]);
  });

  it("an unreadable balance is null, not zero", () => {
    const rows = parseXeroBankSummary({
      Rows: [
        {
          RowType: "Row",
          Cells: [
            { Value: "Chequing", Attributes: [{ Id: "accountID", Value: "a" }] },
            { Value: "n/a" },
          ],
        },
      ],
    });
    expect(rows[0]!.balanceCents).toBeNull();
  });
});

describe("parseQuickbooksBalances", () => {
  const accounts = new Map([
    ["35", { name: "Chequing", kind: "bank" as const }],
    ["41", { name: "Mastercard", kind: "credit_card" as const }],
  ]);

  it("picks out only the bank accounts from a full trial balance", () => {
    const rows = parseQuickbooksBalances(
      {
        Rows: {
          Row: [
            { ColData: [{ value: "Chequing", id: "35" }, { value: "1300.00" }, { value: "" }] },
            { ColData: [{ value: "Mastercard", id: "41" }, { value: "" }, { value: "740.15" }] },
            // Not a bank account — must be ignored entirely.
            { ColData: [{ value: "Sales", id: "77" }, { value: "" }, { value: "9000.00" }] },
          ],
        },
      },
      accounts,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.accountId === "35")!.balanceCents).toBe(130000);
    expect(rows.find((r) => r.accountId === "41")!.balanceCents).toBe(74015);
    expect(rows.some((r) => r.accountId === "77")).toBe(false);
  });

  it("walks nested sections", () => {
    const rows = parseQuickbooksBalances(
      {
        Rows: {
          Row: [
            {
              type: "Section",
              Rows: {
                Row: [
                  { ColData: [{ value: "Chequing", id: "35" }, { value: "500.00" }] },
                ],
              },
            },
          ],
        },
      },
      accounts,
    );
    expect(rows.find((r) => r.accountId === "35")!.balanceCents).toBe(50000);
  });

  it("a known account the report never mentioned comes back null, not missing", () => {
    // Vanishing from the screen is how a month gets closed on books nobody saw.
    const rows = parseQuickbooksBalances({ Rows: { Row: [] } }, accounts);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.balanceCents === null)).toBe(true);
  });

  it("keeps a genuine zero balance as 0, not null", () => {
    const rows = parseQuickbooksBalances(
      { Rows: { Row: [{ ColData: [{ value: "Chequing", id: "35" }, { value: "0.00" }] }] } },
      accounts,
    );
    expect(rows.find((r) => r.accountId === "35")!.balanceCents).toBe(0);
  });

  it("survives a malformed report", () => {
    expect(parseQuickbooksBalances(undefined, accounts)).toHaveLength(2);
    expect(parseQuickbooksBalances({}, accounts)).toHaveLength(2);
  });
});
