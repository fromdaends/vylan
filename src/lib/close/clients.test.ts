import { describe, it, expect } from "vitest";
import { mergeCloseClients } from "./clients";

const qbo = (id: string, name: string | null, company: string | null = null) => ({
  clientId: id,
  clientName: name,
  companyName: company,
});
const xero = (id: string, name: string | null, tenant: string | null = null) => ({
  clientId: id,
  clientName: name,
  tenantName: tenant,
});

describe("mergeCloseClients", () => {
  it("puts BOTH ledgers on the board — a Xero client is not invisible", () => {
    const rows = mergeCloseClients([qbo("a", "Acme")], [xero("b", "Boreal")]);
    expect(rows.map((r) => [r.name, r.provider])).toEqual([
      ["Acme", "quickbooks"],
      ["Boreal", "xero"],
    ]);
  });

  it("a client on both ledgers counts as QuickBooks — the side whose checks run", () => {
    const rows = mergeCloseClients([qbo("a", "Acme")], [xero("a", "Acme")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe("quickbooks");
  });

  it("sorts by name so the board doesn't reshuffle when somebody reconnects", () => {
    // The underlying queries order by connection date, hence the jumbled input.
    const rows = mergeCloseClients(
      [qbo("1", "Zenith"), qbo("2", "acme")],
      [xero("3", "Sébastien")],
    );
    expect(rows.map((r) => r.name)).toEqual(["acme", "Sébastien", "Zenith"]);
  });

  it("falls back to the ledger's own company name, then the id", () => {
    const rows = mergeCloseClients(
      [qbo("a", null, "Acme Books Inc")],
      [xero("b", null, "Boreal Tenant"), xero("c", null, null)],
    );
    const byId = new Map(rows.map((r) => [r.clientId, r.name]));
    expect(byId.get("a")).toBe("Acme Books Inc");
    expect(byId.get("b")).toBe("Boreal Tenant");
    expect(byId.get("c")).toBe("c");
  });

  it("survives empty inputs and skips rows with no client id", () => {
    expect(mergeCloseClients([], [])).toEqual([]);
    expect(mergeCloseClients([qbo("", "ghost")], [xero("", "ghost")])).toEqual([]);
  });
});
