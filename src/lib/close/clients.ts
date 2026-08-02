// Which clients belong on the month-end close board.
//
// The board used to list only QuickBooks-connected clients, so a firm's Xero
// clients were structurally invisible: not "shown as empty", not "shown as
// unavailable" — simply absent, with no way to tell a month of theirs was
// never closed. Half of a mixed firm's book of business silently missing from
// the board that exists to say what is left to do.
//
// So the board takes BOTH ledgers. What the client still owes the firm is
// provider-agnostic (it comes from our own database, not the ledger), and so
// is closing a month — those work for a Xero client exactly as they do for a
// QuickBooks one. The two LEDGER numbers are QuickBooks-only for now, so a
// Xero row reports them as unavailable rather than as zero. That distinction
// is this feature's whole premise: a zero meaning "clean" and a zero meaning
// "nobody looked" are the same pixel.

export type CloseProvider = "quickbooks" | "xero";

export type CloseClient = {
  clientId: string;
  name: string;
  provider: CloseProvider;
};

// PURE: fold the two connection lists into one board list.
//
// A client connected to BOTH ledgers counts as QuickBooks, because that is the
// side whose ledger checks actually run — showing it as Xero would hide checks
// that are available. Sorted by name so the board is stable across reloads
// (the underlying queries order by connection date, which reshuffles the board
// every time somebody reconnects).
export function mergeCloseClients(
  quickbooks: { clientId: string; clientName: string | null; companyName: string | null }[],
  xero: { clientId: string; clientName: string | null; tenantName: string | null }[],
): CloseClient[] {
  const out = new Map<string, CloseClient>();
  for (const c of quickbooks) {
    if (!c.clientId) continue;
    out.set(c.clientId, {
      clientId: c.clientId,
      name: c.clientName ?? c.companyName ?? c.clientId,
      provider: "quickbooks",
    });
  }
  for (const c of xero) {
    // Already listed via QuickBooks → leave it there, checks win.
    if (!c.clientId || out.has(c.clientId)) continue;
    out.set(c.clientId, {
      clientId: c.clientId,
      name: c.clientName ?? c.tenantName ?? c.clientId,
      provider: "xero",
    });
  }
  return [...out.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
