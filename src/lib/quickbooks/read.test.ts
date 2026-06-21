import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the read context (token+realm+env) and the network query; keep the rest of
// the client real (QuickbooksError must stay genuine).
vi.mock("@/lib/quickbooks/connection", () => ({
  getQuickbooksReadContext: vi.fn(),
}));
vi.mock("@/lib/quickbooks/client", async (importActual) => {
  const actual = await importActual<typeof import("./client")>();
  return { ...actual, quickbooksQuery: vi.fn() };
});

import { readChartOfAccounts, toAccount } from "./read";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksQuery, QuickbooksError } from "@/lib/quickbooks/client";

const mockCtx = vi.mocked(getQuickbooksReadContext);
const mockQuery = vi.mocked(quickbooksQuery);

const CTX = { accessToken: "AT", realmId: "r1", environment: "sandbox" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toAccount", () => {
  it("maps the raw QBO account and defaults Active to true when omitted", () => {
    expect(toAccount({ Id: "5", Name: " Checking ", AccountType: "Bank" })).toEqual({
      id: "5",
      name: "Checking",
      accountType: "Bank",
      active: true,
    });
  });
  it("treats an explicit Active:false as inactive, and missing type as null", () => {
    expect(toAccount({ Id: "6", Name: "Old", Active: false }).active).toBe(false);
    expect(toAccount({}).accountType).toBeNull();
  });
});

describe("readChartOfAccounts", () => {
  it("returns not_connected when there is no read context (and never queries)", async () => {
    mockCtx.mockResolvedValue(null);
    expect(await readChartOfAccounts("f1")).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("queries SELECT * FROM Account and maps the rows on success", async () => {
    mockCtx.mockResolvedValue(CTX);
    mockQuery.mockResolvedValue({
      Account: [{ Id: "1", Name: "Checking", AccountType: "Bank" }],
    });
    const r = await readChartOfAccounts("f1");
    expect(r).toEqual({
      ok: true,
      data: [{ id: "1", name: "Checking", accountType: "Bank", active: true }],
    });
    expect(mockQuery).toHaveBeenCalledWith(
      "AT",
      "r1",
      "SELECT * FROM Account",
      "sandbox",
    );
  });

  it("returns empty data when the company has no accounts", async () => {
    mockCtx.mockResolvedValue(CTX);
    mockQuery.mockResolvedValue({});
    expect(await readChartOfAccounts("f1")).toEqual({ ok: true, data: [] });
  });

  it("returns a soft error when the query throws", async () => {
    mockCtx.mockResolvedValue(CTX);
    mockQuery.mockRejectedValue(new QuickbooksError("read_failed", "boom", 500));
    expect(await readChartOfAccounts("f1")).toEqual({
      ok: false,
      reason: "error",
    });
  });
});
