// Not categorised, as a tab of the Bookkeeping page's Logs panel.
//
// The data fetch that used to be /quickbooks/uncategorized' page body. That
// route still exists and redirects here.
//
// ALSO RENDERED ON ONE CLIENT'S PAGE (?tab=bookkeeping), via lockedClientId —
// see receipts-tab.tsx for why that is a prop rather than a second file.

import { getTranslations } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import {
  readAccounts,
  scanUncategorized,
  type LedgerAccount,
} from "@/lib/quickbooks/uncategorized";
import { listEngagements } from "@/lib/db/engagements";
import { ledgerAnswersForClient } from "@/lib/db/ledger-question";
import { UncategorizedList } from "@/components/quickbooks/uncategorized-list";
import { NoConnectedClients } from "./no-connected-clients";

const DEFAULT_DAYS = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function UncategorizedTab({
  sp,
  lockedClientId,
}: {
  sp: { client?: string; from?: string; to?: string };
  // See receipts-tab.tsx — one client's page, no client picker, no
  // "go connect someone" empty state.
  lockedClientId?: string;
}) {
  const t = await getTranslations("Quickbooks");
  const [firm, clients] = await Promise.all([
    getCurrentFirm(),
    listFirmQuickbooksConnectedClients(),
  ]);

  if (!firm || clients.length === 0) {
    return lockedClientId ? null : (
      <NoConnectedClients body={t("uncat_not_connected")} />
    );
  }

  const selected = lockedClientId
    ? clients.find((c) => c.clientId === lockedClientId)
    : (clients.find((c) => c.clientId === sp.client) ?? clients[0]!);
  if (!selected) return null;
  const from = isIsoDate(sp.from) ? sp.from : isoDaysAgo(DEFAULT_DAYS);
  const to = isIsoDate(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);

  const ctx = await getQuickbooksReadContext(firm.id, selected.clientId);

  let scan: Awaited<ReturnType<typeof scanUncategorized>> | null = null;
  let accounts: LedgerAccount[] = [];
  let scanError = false;
  if (ctx) {
    try {
      // One account read feeds both the scan and the picker.
      accounts = await readAccounts(ctx);
      scan = await scanUncategorized(ctx, { from, to, accounts });
    } catch (err) {
      console.error("[uncategorized] scan failed:", err);
      scanError = true;
    }
  }

  const parkingIds = new Set((scan?.parkingAccounts ?? []).map((a) => a.id));

  const engagements = (
    await listEngagements({ client_id: selected.clientId })
  ).filter((e) => e.status !== "complete" && e.status !== "cancelled");

  const answers = await ledgerAnswersForClient(selected.clientId);

  return (
    <UncategorizedList
      clients={clients.map((c) => ({
        id: c.clientId,
        name: c.clientName ?? c.companyName ?? c.clientId,
      }))}
      lockedClient={Boolean(lockedClientId)}
      selectedClientId={selected.clientId}
      from={from}
      to={to}
      txns={scan?.txns ?? []}
      considered={scan?.considered ?? 0}
      truncated={scan?.truncated ?? false}
      scanFailed={scanError || !ctx}
      parkingAccounts={(scan?.parkingAccounts ?? []).map((a) => a.name)}
      accounts={accounts
        .filter((a) => a.active && !parkingIds.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, type: a.accountType }))}
      engagements={engagements.map((e) => ({
        id: e.id,
        title: e.title ?? e.id,
      }))}
      asked={[...answers.entries()].map(([key, a]) => ({
        key,
        answer: a.answer,
      }))}
    />
  );
}
