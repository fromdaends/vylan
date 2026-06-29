import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the read context (token+realm+env) and the network query; keep the rest of
// the client real (QuickbooksError must stay genuine).
vi.mock("@/lib/quickbooks/connection", () => ({
  getQuickbooksReadContext: vi.fn(),
}));
vi.mock("@/lib/quickbooks/client", async (importActual) => {
  const actual = await importActual<typeof import("./client")>();
  return { ...actual, quickbooksQuery: vi.fn() };
});

import {
  readQuickbooksLists,
  toAccount,
  toVendor,
  toCustomer,
  toTaxCode,
  toItem,
} from "./read";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksQuery, QuickbooksError } from "@/lib/quickbooks/client";

const mockCtx = vi.mocked(getQuickbooksReadContext);
const mockQuery = vi.mocked(quickbooksQuery);

const CTX = { accessToken: "AT", realmId: "r1", environment: "sandbox" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("mappers", () => {
  it("toAccount maps name+type and defaults Active to true when omitted", () => {
    expect(toAccount({ Id: "1", Name: " Checking ", AccountType: "Bank" })).toEqual({
      id: "1",
      name: "Checking",
      accountType: "Bank",
      active: true,
    });
    expect(toAccount({ Id: "2", Name: "Old", Active: false }).active).toBe(false);
    expect(toAccount({}).accountType).toBeNull();
  });
  it("toVendor prefers DisplayName, falls back to CompanyName", () => {
    expect(toVendor({ Id: "3", DisplayName: "Acme" }).name).toBe("Acme");
    expect(toVendor({ Id: "4", CompanyName: "Beta Inc" }).name).toBe("Beta Inc");
  });
  it("toCustomer + toTaxCode map id/name/active", () => {
    expect(toCustomer({ Id: "5", DisplayName: "Bob" })).toEqual({
      id: "5",
      name: "Bob",
      active: true,
    });
    expect(
      toItem({
        Id: "7",
        Name: "Consulting",
        FullyQualifiedName: "Services:Consulting",
        Type: "Service",
        IncomeAccountRef: { value: "10" },
      }),
    ).toEqual({
      id: "7",
      name: "Services:Consulting",
      itemType: "Service",
      incomeAccountId: "10",
      active: true,
    });
    expect(toTaxCode({ Id: "6", Name: "GST", Active: false })).toEqual({
      id: "6",
      name: "GST",
      active: false,
    });
  });
});

// Default mock: one page per entity.
function singlePageMock() {
  mockQuery.mockImplementation(async (_at, _realm, sql) => {
    if (sql.includes("FROM Account"))
      return { Account: [{ Id: "1", Name: "Checking", AccountType: "Bank" }] };
    if (sql.includes("FROM Vendor")) return { Vendor: [{ Id: "2", DisplayName: "Acme" }] };
    if (sql.includes("FROM Customer"))
      return { Customer: [{ Id: "3", DisplayName: "Bob" }] };
    if (sql.includes("FROM TaxCode")) return { TaxCode: [{ Id: "4", Name: "GST" }] };
    if (sql.includes("FROM Item"))
      return {
        Item: [
          {
            Id: "7",
            Name: "Consulting",
            Type: "Service",
            IncomeAccountRef: { value: "10" },
          },
        ],
      };
    return {};
  });
}

describe("readQuickbooksLists", () => {
  it("returns not_connected when there is no read context (and never queries)", async () => {
    mockCtx.mockResolvedValue(null);
    expect(await readQuickbooksLists("f1")).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reads all five lists and maps each", async () => {
    mockCtx.mockResolvedValue(CTX);
    singlePageMock();
    const r = await readQuickbooksLists("f1");
    expect(r).toEqual({
      ok: true,
      data: {
        accounts: [{ id: "1", name: "Checking", accountType: "Bank", active: true }],
        vendors: [{ id: "2", name: "Acme", active: true }],
        customers: [{ id: "3", name: "Bob", active: true }],
        taxCodes: [{ id: "4", name: "GST", active: true }],
        items: [
          {
            id: "7",
            name: "Consulting",
            itemType: "Service",
            incomeAccountId: "10",
            active: true,
          },
        ],
      },
    });
    // Sequential, paged, and includes inactive records (WHERE Active IN ...).
    expect(mockQuery).toHaveBeenCalledWith(
      "AT",
      "r1",
      "SELECT * FROM Account WHERE Active IN (true, false) STARTPOSITION 1 MAXRESULTS 1000",
      "sandbox",
    );
  });

  it("soft-fails a single list to null without sinking the others", async () => {
    mockCtx.mockResolvedValue(CTX);
    mockQuery.mockImplementation(async (_at, _realm, sql) => {
      if (sql.includes("FROM Vendor")) {
        throw new QuickbooksError("read_failed", "boom", 500);
      }
      if (sql.includes("FROM Account")) return { Account: [{ Id: "1", Name: "A" }] };
      return {};
    });
    const r = await readQuickbooksLists("f1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.vendors).toBeNull();
      expect(r.data.accounts).toEqual([
        { id: "1", name: "A", accountType: null, active: true },
      ]);
      expect(r.data.customers).toEqual([]);
    }
  });

  it("paginates a list that fills a page (STARTPOSITION advances by 1000)", async () => {
    mockCtx.mockResolvedValue(CTX);
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      Id: String(i),
      Name: "A",
    }));
    mockQuery.mockImplementation(async (_at, _realm, sql) => {
      if (sql.includes("FROM Account")) {
        if (sql.includes("STARTPOSITION 1 ")) return { Account: fullPage };
        if (sql.includes("STARTPOSITION 1001 ")) return { Account: [{ Id: "x", Name: "last" }] };
        return {};
      }
      return {};
    });
    const r = await readQuickbooksLists("f1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.accounts).toHaveLength(1001);
  });
});

// The rate-limit (429) back-off path uses a real setTimeout, so drive it with
// fake timers to keep the suite fast.
describe("readQuickbooksLists rate-limit handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries ONCE on a 429 then succeeds (exactly two calls for that list)", async () => {
    mockCtx.mockResolvedValue(CTX);
    let accountCalls = 0;
    mockQuery.mockImplementation(async (_at, _realm, sql) => {
      if (sql.includes("FROM Account")) {
        accountCalls++;
        if (accountCalls === 1) throw new QuickbooksError("read_failed", "429", 429);
        return { Account: [{ Id: "1", Name: "A" }] };
      }
      return {};
    });
    const p = readQuickbooksLists("f1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.data.accounts).toEqual([
        { id: "1", name: "A", accountType: null, active: true },
      ]);
    expect(accountCalls).toBe(2);
  });

  it("does NOT retry a non-429 error (one call, list null)", async () => {
    mockCtx.mockResolvedValue(CTX);
    let vendorCalls = 0;
    mockQuery.mockImplementation(async (_at, _realm, sql) => {
      if (sql.includes("FROM Vendor")) {
        vendorCalls++;
        throw new QuickbooksError("read_failed", "500", 500);
      }
      return {};
    });
    const p = readQuickbooksLists("f1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok && r.data.vendors).toBeNull();
    expect(vendorCalls).toBe(1);
  });

  it("surfaces a null list after two consecutive 429s", async () => {
    mockCtx.mockResolvedValue(CTX);
    mockQuery.mockImplementation(async (_at, _realm, sql) => {
      if (sql.includes("FROM Customer"))
        throw new QuickbooksError("read_failed", "429", 429);
      return {};
    });
    const p = readQuickbooksLists("f1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok && r.data.customers).toBeNull();
  });
});
