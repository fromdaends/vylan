// Which bookkeeping provider drives a client's draft pipeline — QuickBooks or
// Xero. A client connects EITHER QuickBooks OR Xero, never both (enforced at
// connect time), so the provider is fully determined by the client's connection.
//
// SERVICE-ROLE only: the sole caller is the background classify worker
// (src/lib/ai/process.ts), which has no authenticated session, so RLS can't
// scope the reads. Both underlying checks (isClientXeroConnected /
// isFirmQuickbooksConnected) go through the service role and degrade to false
// before their tables exist (0740 / 0410) — so a firm using neither, or an
// environment missing the schema, simply resolves to null (no draft pipeline).
//
// Xero is checked FIRST: Xero connections are per-client from day one, whereas a
// pre-0710 firm-level QuickBooks row could linger; if somehow both existed, the
// per-client Xero link is the more specific (and current) signal.

import { isClientXeroConnected } from "@/lib/db/xero";
import { isFirmQuickbooksConnected } from "@/lib/db/quickbooks";

export type BookkeepingProvider = "quickbooks" | "xero";

export async function resolveBookkeepingProvider(
  firmId: string,
  clientId: string | null,
): Promise<BookkeepingProvider | null> {
  // Xero is always per-client — no client id means no Xero connection to find.
  if (clientId && (await isClientXeroConnected(firmId, clientId))) {
    return "xero";
  }
  if (await isFirmQuickbooksConnected(firmId, clientId)) {
    return "quickbooks";
  }
  return null;
}
