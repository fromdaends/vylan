// Missing receipts, as a tab of the Bookkeeping page's Logs panel.
//
// The data fetch that used to be /quickbooks/receipts' page body. That route
// still exists and redirects here, so old links and bookmarks survive.

import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { listEngagements } from "@/lib/db/engagements";
import { scanReceiptGaps } from "@/lib/quickbooks/receipt-gap";
import { alreadyChasedKeys } from "@/lib/db/receipt-chase";
import { ReceiptGaps } from "@/components/quickbooks/receipt-gaps";
import { NoConnectedClients } from "./no-connected-clients";

// A quarter is the unit a bookkeeping client thinks in, and it keeps the first
// load quick.
const DEFAULT_DAYS = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function ReceiptsTab({
  locale,
  sp,
}: {
  locale: AppLocale;
  sp: { client?: string; from?: string; to?: string };
}) {
  const t = await getTranslations("Quickbooks");
  const [firm, clients] = await Promise.all([
    getCurrentFirm(),
    listFirmQuickbooksConnectedClients(),
  ]);

  if (!firm || clients.length === 0) {
    return <NoConnectedClients body={t("gaps_not_connected")} />;
  }

  const selected = clients.find((c) => c.clientId === sp.client) ?? clients[0]!;
  const from = isIsoDate(sp.from) ? sp.from : isoDaysAgo(DEFAULT_DAYS);
  const to = isIsoDate(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);

  const ctx = await getQuickbooksReadContext(firm.id, selected.clientId);

  let scan: Awaited<ReturnType<typeof scanReceiptGaps>> | null = null;
  let scanError = false;
  if (ctx) {
    try {
      scan = await scanReceiptGaps(ctx, { from, to });
    } catch (err) {
      // "We couldn't look" must never render as "nothing to find".
      console.error("[missing receipts] scan failed:", err);
      scanError = true;
    }
  }

  const engagements = (
    await listEngagements({ client_id: selected.clientId })
  ).filter((e) => e.status !== "complete" && e.status !== "cancelled");

  const chased =
    engagements.length > 0
      ? await (async () => {
          const sets = await Promise.all(
            engagements.map((e) => alreadyChasedKeys(e.id)),
          );
          return new Set(sets.flatMap((s) => [...s]));
        })()
      : new Set<string>();

  return (
    <ReceiptGaps
      clients={clients.map((c) => ({
        id: c.clientId,
        name: c.clientName ?? c.companyName ?? c.clientId,
      }))}
      selectedClientId={selected.clientId}
      from={from}
      to={to}
      gaps={scan?.gaps ?? []}
      considered={scan?.considered ?? 0}
      truncated={scan?.truncated ?? false}
      scanFailed={scanError || !ctx}
      alreadyChased={[...chased]}
      engagements={engagements.map((e) => ({
        id: e.id,
        title: e.title ?? e.id,
      }))}
      locale={locale}
    />
  );
}
