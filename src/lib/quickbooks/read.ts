// QuickBooks read layer — Stage 2, READ-ONLY.
//
// Pulls reference lists from the connected QuickBooks company via the /query
// endpoint. Phase 1: the Chart of Accounts. Everything here is read-only (no
// writes, no transactions) and runs server-side only — the tokens are
// service-role, so a browser can never call QuickBooks directly.

import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksQuery, QuickbooksError } from "@/lib/quickbooks/client";

export type QbAccount = {
  id: string;
  name: string;
  accountType: string | null;
  active: boolean;
};

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_connected" | "error" };

type RawAccount = {
  Id?: string;
  Name?: string;
  AccountType?: string;
  Active?: boolean;
};

// Map the (much larger) raw QBO Account object down to the few fields we use.
export function toAccount(r: RawAccount): QbAccount {
  return {
    id: String(r.Id ?? ""),
    name: (r.Name ?? "").trim(),
    accountType: r.AccountType ?? null,
    // QBO omits Active when true; treat anything but an explicit false as active.
    active: r.Active !== false,
  };
}

// Read the connected company's Chart of Accounts. Phase 1 reads the first page
// only (QBO returns up to 100 rows; pagination for the longer lists lands in
// Phase 2). Returns a typed soft result so the UI can show a calm note rather
// than crashing.
export async function readChartOfAccounts(
  firmId: string,
): Promise<ReadResult<QbAccount[]>> {
  const ctx = await getQuickbooksReadContext(firmId);
  if (!ctx) return { ok: false, reason: "not_connected" };
  try {
    const qr = await quickbooksQuery(
      ctx.accessToken,
      ctx.realmId,
      "SELECT * FROM Account",
      ctx.environment,
    );
    const rows = (qr.Account as RawAccount[] | undefined) ?? [];
    return { ok: true, data: rows.map(toAccount) };
  } catch (e) {
    if (e instanceof QuickbooksError) {
      console.error("[quickbooks] readChartOfAccounts failed:", e.code, e.message);
    } else {
      console.error("[quickbooks] readChartOfAccounts unexpected error:", e);
    }
    return { ok: false, reason: "error" };
  }
}
