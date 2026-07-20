// "Import your client list from QuickBooks" — reads the CUSTOMERS of the
// firm's OWN QuickBooks company (the books where the accountant invoices their
// clients) and maps them to staging candidates. Used transiently by the OAuth
// callback (import intent): nothing is stored provider-side and the tokens are
// revoked right after the read.

import {
  quickbooksQuery,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";
import type { ImportCandidate } from "@/lib/db/client-import";

// Pure mapper from QBO Customer rows to import candidates (unit-tested).
// DisplayName is QBO's required unique customer name; email/phone are optional
// nested shapes.
export function customerCandidatesFromQuery(
  rows: unknown,
): ImportCandidate[] {
  if (!Array.isArray(rows)) return [];
  const out: ImportCandidate[] = [];
  for (const r of rows) {
    const c = r as {
      DisplayName?: unknown;
      PrimaryEmailAddr?: { Address?: unknown } | null;
      PrimaryPhone?: { FreeFormNumber?: unknown } | null;
    };
    const name =
      typeof c.DisplayName === "string" ? c.DisplayName.trim() : "";
    if (!name) continue;
    const email = c.PrimaryEmailAddr?.Address;
    const phone = c.PrimaryPhone?.FreeFormNumber;
    out.push({
      display_name: name,
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
    });
  }
  return out;
}

// Read the active customers (up to 1000 — the same cap the CSV import commits)
// from the just-authorized company. Called with the raw tokens from the
// exchange — no stored connection exists for an import.
export async function fetchQuickbooksCustomerCandidates(
  accessToken: string,
  realmId: string,
  environment: QuickbooksEnvironment,
): Promise<ImportCandidate[]> {
  const qr = await quickbooksQuery(
    accessToken,
    realmId,
    "SELECT DisplayName, PrimaryEmailAddr, PrimaryPhone FROM Customer WHERE Active = true ORDERBY DisplayName MAXRESULTS 1000",
    environment,
  );
  return customerCandidatesFromQuery(
    (qr as { Customer?: unknown }).Customer ?? [],
  );
}
