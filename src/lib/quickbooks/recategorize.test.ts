import { describe, it, expect } from "vitest";
import { retargetLines, isQboId } from "./recategorize";

const OFFICE = { id: "9", name: "Office Expenses" };

const purchase = () => ({
  Id: "42",
  SyncToken: "3",
  TxnDate: "2026-07-03",
  TotalAmt: 150,
  EntityRef: { value: "3", name: "Costco" },
  Line: [
    {
      Id: "1",
      Amount: 100,
      DetailType: "AccountBasedExpenseLineDetail",
      Description: "COSTCO WHOLESALE #443",
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: "7", name: "Uncategorised Expense" },
        TaxCodeRef: { value: "HST ON" },
      },
    },
    {
      Id: "2",
      Amount: 50,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: "11", name: "Meals and Entertainment" },
      },
    },
  ],
});

describe("retargetLines", () => {
  it("moves the named line onto the new account", () => {
    const { body, changed } = retargetLines(purchase(), "purchase", ["1"], OFFICE);
    const lines = body.Line as Array<Record<string, unknown>>;
    const detail = lines[0]!.AccountBasedExpenseLineDetail as {
      AccountRef: { value: string; name: string };
    };
    expect(detail.AccountRef).toEqual({ value: "9", name: "Office Expenses" });
    expect(changed).toEqual(["1"]);
  });

  it("leaves every other line exactly as it was", () => {
    // The line somebody already categorised. Re-pointing it would be invisible
    // vandalism — QuickBooks records nothing about who moved it or why.
    const { body } = retargetLines(purchase(), "purchase", ["1"], OFFICE);
    const lines = body.Line as Array<Record<string, unknown>>;
    expect(lines[1]).toEqual(purchase().Line[1]);
  });

  it("keeps the whole Line array", () => {
    // The reason this is a full update and not a sparse one: a sparse update
    // naming line 1 would come back with line 2 DELETED, and the transaction
    // would be wrong by $50 with nothing to show why.
    const { body } = retargetLines(purchase(), "purchase", ["1"], OFFICE);
    expect((body.Line as unknown[]).length).toBe(2);
  });

  it("carries amount, tax and description through untouched", () => {
    const { body } = retargetLines(purchase(), "purchase", ["1"], OFFICE);
    const line = (body.Line as Array<Record<string, unknown>>)[0]!;
    expect(line.Amount).toBe(100);
    expect(line.Description).toBe("COSTCO WHOLESALE #443");
    const detail = line.AccountBasedExpenseLineDetail as {
      TaxCodeRef: { value: string };
    };
    expect(detail.TaxCodeRef).toEqual({ value: "HST ON" });
  });

  it("keeps the SyncToken so QuickBooks can refuse a stale write", () => {
    const { body } = retargetLines(purchase(), "purchase", ["1"], OFFICE);
    expect(body.SyncToken).toBe("3");
    expect(body.Id).toBe("42");
  });

  it("reports nothing changed when the line is already gone", () => {
    // Somebody categorised it between the firm loading the list and pressing
    // the button. That is stale, not broken — and the caller must not write.
    const { changed } = retargetLines(purchase(), "purchase", ["99"], OFFICE);
    expect(changed).toEqual([]);
  });

  it("will not touch an item-based line", () => {
    // It points at a product, not an account. There is no account on it to move.
    const txn = {
      Id: "42",
      Line: [
        {
          Id: "1",
          Amount: 100,
          DetailType: "ItemBasedExpenseLineDetail",
          ItemBasedExpenseLineDetail: { ItemRef: { value: "3" } },
        },
      ],
    };
    const { body, changed } = retargetLines(txn, "purchase", ["1"], OFFICE);
    expect(changed).toEqual([]);
    expect(body.Line).toEqual(txn.Line);
  });

  it("uses the deposit line-detail block for a deposit", () => {
    const txn = {
      Id: "77",
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
    };
    const { body, changed } = retargetLines(txn, "deposit", ["1"], {
      id: "12",
      name: "Sales",
    });
    const detail = (body.Line as Array<Record<string, unknown>>)[0]!
      .DepositLineDetail as {
      AccountRef: { value: string };
      Entity: { name: string };
    };
    expect(changed).toEqual(["1"]);
    expect(detail.AccountRef.value).toBe("12");
    // The payer is not ours to change.
    expect(detail.Entity.name).toBe("Gagnon Ltée");
  });

  it("sends the account id alone when the name is unknown", () => {
    const { body } = retargetLines(purchase(), "purchase", ["1"], {
      id: "9",
      name: null,
    });
    const detail = (body.Line as Array<Record<string, unknown>>)[0]!
      .AccountBasedExpenseLineDetail as { AccountRef: Record<string, unknown> };
    expect(detail.AccountRef).toEqual({ value: "9" });
  });

  it("does not mutate the transaction it was given", () => {
    const original = purchase();
    retargetLines(original, "purchase", ["1"], OFFICE);
    const detail = original.Line[0]!.AccountBasedExpenseLineDetail as {
      AccountRef: { value: string };
    };
    expect(detail.AccountRef.value).toBe("7");
  });
});

describe("isQboId", () => {
  it("accepts a QuickBooks id", () => {
    expect(isQboId("42")).toBe(true);
  });

  it("rejects anything that could steer a query", () => {
    // The id is interpolated into QuickBooks' query language, so this is the
    // gate that keeps a crafted value out of it.
    expect(isQboId("42' OR '1'='1")).toBe(false);
    expect(isQboId("")).toBe(false);
    expect(isQboId("abc")).toBe(false);
  });
});
