import { describe, it, expect } from "vitest";
import {
  isUncategorizedAccountName,
  rowsToAccounts,
  uncategorizedAmong,
  rowToUncatTxn,
  sortUncat,
  describeUncatForClient,
  uncatKey,
  lineDetailKeyOf,
  tableOf,
  type UncatTxn,
} from "./uncategorized";

const UNCAT_IDS = new Set(["7", "8"]);

const expenseLine = (
  id: string | null,
  accountId: string,
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  ...(id ? { Id: id } : {}),
  Amount: amount,
  DetailType: "AccountBasedExpenseLineDetail",
  AccountBasedExpenseLineDetail: {
    AccountRef: { value: accountId, name: `Account ${accountId}` },
  },
  ...extra,
});

describe("isUncategorizedAccountName", () => {
  it("recognises the accounts QuickBooks creates by itself", () => {
    expect(isUncategorizedAccountName("Uncategorized Expense")).toBe(true);
    expect(isUncategorizedAccountName("Uncategorised Income")).toBe(true);
    expect(isUncategorizedAccountName("Uncategorized Asset")).toBe(true);
    expect(isUncategorizedAccountName("Ask My Accountant")).toBe(true);
  });

  it("handles the French company files", () => {
    expect(isUncategorizedAccountName("Non catégorisé")).toBe(true);
    expect(isUncategorizedAccountName("Sans catégorie")).toBe(true);
    expect(isUncategorizedAccountName("Demander à mon comptable")).toBe(true);
  });

  it("ignores capitalisation", () => {
    expect(isUncategorizedAccountName("UNCATEGORIZED EXPENSE")).toBe(true);
    expect(isUncategorizedAccountName("ask my accountant")).toBe(true);
  });

  it("does not sweep in an account that merely mentions the word", () => {
    // A real, deliberately-used account. Treating it as a parking account would
    // put the firm's own reconciliations in front of a client as questions.
    expect(isUncategorizedAccountName("Transfer from Uncategorised Asset")).toBe(
      false,
    );
    expect(isUncategorizedAccountName("Suspense")).toBe(false);
    expect(isUncategorizedAccountName("Office Expenses")).toBe(false);
  });

  it("treats a blank name as not uncategorised", () => {
    expect(isUncategorizedAccountName(null)).toBe(false);
    expect(isUncategorizedAccountName("   ")).toBe(false);
  });
});

describe("rowsToAccounts / uncategorizedAmong", () => {
  const rows = [
    { Id: "7", Name: "Uncategorised Expense", AccountType: "Expense" },
    { Id: "9", Name: "Office Expenses", AccountType: "Expense" },
    { Id: "8", Name: "Ask My Accountant", AccountType: "Other Expense" },
    { Id: "10", Name: "Old Account", AccountType: "Expense", Active: false },
  ];

  it("reads the whole chart of accounts", () => {
    expect(rowsToAccounts(rows).map((a) => a.id)).toEqual(["7", "9", "8", "10"]);
  });

  it("picks out just the parking accounts", () => {
    expect(uncategorizedAmong(rowsToAccounts(rows)).map((a) => a.id)).toEqual([
      "7",
      "8",
    ]);
  });

  it("treats a missing Active flag as active", () => {
    const accounts = rowsToAccounts(rows);
    expect(accounts[0]!.active).toBe(true);
    expect(accounts[3]!.active).toBe(false);
  });

  it("skips rows missing an id or a name", () => {
    expect(
      rowsToAccounts([{ Name: "Uncategorised Expense" }, { Id: "7" }]),
    ).toEqual([]);
  });
});

describe("rowToUncatTxn", () => {
  it("finds the parked line on a half-coded expense", () => {
    // The case that makes line-level precision matter: someone already coded the
    // second line. Only the first is still parked.
    const txn = rowToUncatTxn(
      "Purchase",
      {
        Id: "42",
        TxnDate: "2026-07-03",
        TotalAmt: 150,
        EntityRef: { value: "3", name: "Costco" },
        CurrencyRef: { value: "CAD" },
        Line: [
          expenseLine("1", "7", 100, { Description: "COSTCO WHOLESALE #443" }),
          expenseLine("2", "9", 50),
        ],
      },
      UNCAT_IDS,
    );
    expect(txn).not.toBeNull();
    expect(txn!.lineIds).toEqual(["1"]);
    expect(txn!.uncatAmt).toBe(100);
    expect(txn!.totalAmt).toBe(150);
    expect(txn!.partyName).toBe("Costco");
    expect(txn!.memo).toBe("COSTCO WHOLESALE #443");
    expect(txn!.currency).toBe("CAD");
    expect(txn!.entity).toBe("purchase");
  });

  it("returns null when every line already has a real account", () => {
    expect(
      rowToUncatTxn(
        "Purchase",
        { Id: "42", TotalAmt: 50, Line: [expenseLine("1", "9", 50)] },
        UNCAT_IDS,
      ),
    ).toBeNull();
  });

  it("skips a parked line that has no id", () => {
    // Nothing can be written back to a line we cannot name, so a transaction
    // whose only parked line is anonymous is not offered as fixable.
    expect(
      rowToUncatTxn(
        "Purchase",
        { Id: "42", TotalAmt: 50, Line: [expenseLine(null, "7", 50)] },
        UNCAT_IDS,
      ),
    ).toBeNull();
  });

  it("adds up several parked lines on one transaction", () => {
    const txn = rowToUncatTxn(
      "Bill",
      {
        Id: "9",
        TotalAmt: 300,
        VendorRef: { value: "2", name: "Bell Canada" },
        Line: [
          expenseLine("1", "7", 100),
          expenseLine("2", "8", 125),
          expenseLine("3", "9", 75),
        ],
      },
      UNCAT_IDS,
    );
    expect(txn!.lineIds).toEqual(["1", "2"]);
    expect(txn!.uncatAmt).toBe(225);
    expect(txn!.entity).toBe("bill");
    expect(txn!.partyName).toBe("Bell Canada");
  });

  it("reads a Deposit through its own line-detail block", () => {
    // Uncategorised Income and Uncategorised Asset fill up from deposits and
    // nothing else. A scan that only knew about expenses would close a month
    // with unexplained money sitting in it.
    const txn = rowToUncatTxn(
      "Deposit",
      {
        Id: "77",
        TxnDate: "2026-07-10",
        TotalAmt: 900,
        Line: [
          {
            Id: "1",
            Amount: 900,
            DetailType: "DepositLineDetail",
            DepositLineDetail: {
              AccountRef: { value: "8", name: "Uncategorised Income" },
              Entity: { value: "5", name: "Gagnon Ltée" },
            },
          },
        ],
      },
      UNCAT_IDS,
    );
    expect(txn!.entity).toBe("deposit");
    expect(txn!.uncatAmt).toBe(900);
    expect(txn!.accountName).toBe("Uncategorised Income");
    expect(txn!.partyName).toBe("Gagnon Ltée");
  });

  it("falls back to the transaction note when the line has no description", () => {
    const txn = rowToUncatTxn(
      "Purchase",
      {
        Id: "42",
        TotalAmt: 20,
        PrivateNote: "  ETRANSFER 8837  ",
        Line: [expenseLine("1", "7", 20)],
      },
      UNCAT_IDS,
    );
    expect(txn!.memo).toBe("ETRANSFER 8837");
  });

  it("falls back to the transaction total when TotalAmt is absent", () => {
    const txn = rowToUncatTxn(
      "Purchase",
      { Id: "42", Line: [expenseLine("1", "7", 33)] },
      UNCAT_IDS,
    );
    expect(txn!.totalAmt).toBe(33);
  });
});

describe("sortUncat", () => {
  it("puts the biggest uncoded amount first, refunds included", () => {
    // A -2,000 refund nobody coded matters as much as a +2,000 charge, so the
    // sort is on size rather than sign.
    const mk = (id: string, uncatAmt: number) =>
      ({ qboId: id, uncatAmt }) as UncatTxn;
    const sorted = sortUncat([mk("a", 40), mk("b", -2000), mk("c", 300)]);
    expect(sorted.map((t) => t.qboId)).toEqual(["b", "c", "a"]);
  });
});

describe("describeUncatForClient", () => {
  const base: UncatTxn = {
    qboId: "42",
    entity: "purchase",
    txnDate: "2026-07-03",
    totalAmt: 340,
    uncatAmt: 340,
    currency: "CAD",
    docNumber: null,
    partyName: "Costco",
    accountName: "Uncategorised Expense",
    memo: "COSTCO WHOLESALE #443",
    lineIds: ["1"],
  };

  it("names what the client would recognise", () => {
    expect(describeUncatForClient(base)).toBe(
      "340.00 CAD — Costco on July 3, 2026",
    );
  });

  it("speaks French", () => {
    expect(describeUncatForClient(base, { locale: "fr" })).toBe(
      "340.00 CAD — Costco le 3 juillet 2026",
    );
  });

  it("uses the bank descriptor when the books never named anyone", () => {
    // Which is most of the time — a bank feed line has a descriptor, not a
    // supplier, and that string is the only thing that will jog a memory.
    expect(describeUncatForClient({ ...base, partyName: null })).toContain(
      "COSTCO WHOLESALE #443",
    );
  });

  it("does not shift the date for anyone west of UTC", () => {
    // An ISO date from QuickBooks is a calendar date. Putting it through a Date
    // would render "July 1" as "June 30" for the whole of Canada.
    expect(describeUncatForClient({ ...base, txnDate: "2026-07-01" })).toContain(
      "July 1, 2026",
    );
  });

  it("survives a transaction with no date and no party", () => {
    const desc = describeUncatForClient({
      ...base,
      txnDate: null,
      partyName: null,
      memo: null,
    });
    expect(desc).toBe("340.00 CAD payment");
  });
});

describe("keys and table mapping", () => {
  it("keeps ids of different entity types apart", () => {
    // Same trap as the receipt scan: QuickBooks ids are unique per type, so a
    // bare-id key would confuse Bill 42 with Purchase 42.
    expect(uncatKey("bill", "42")).not.toBe(uncatKey("purchase", "42"));
  });

  it("maps each entity to its table and line-detail block", () => {
    expect(tableOf("purchase")).toBe("Purchase");
    expect(tableOf("bill")).toBe("Bill");
    expect(tableOf("deposit")).toBe("Deposit");
    expect(lineDetailKeyOf("purchase")).toBe("AccountBasedExpenseLineDetail");
    expect(lineDetailKeyOf("deposit")).toBe("DepositLineDetail");
  });
});
