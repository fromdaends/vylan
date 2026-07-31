// Missing receipts — the expenses in a client's books with no paper behind them.
//
// The rest of Vylan's bookkeeping runs forwards: a document arrives and becomes
// a transaction. This screen runs backwards. It reads what is already recorded
// in the client's ledger, shows the entries nothing supports, and lets the firm
// ask the client for them in one go.
//
// Always live, never cached: the answer changes the moment anyone attaches a
// receipt, in Vylan or in QuickBooks itself, and a stale list here means asking
// a client for something they already sent.

export const dynamic = "force-dynamic";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { listEngagements } from "@/lib/db/engagements";
import { scanReceiptGaps } from "@/lib/quickbooks/receipt-gap";
import { alreadyChasedKeys } from "@/lib/db/receipt-chase";
import { ReceiptGaps } from "@/components/quickbooks/receipt-gaps";
import { ReceiptIcon } from "@/components/quickbooks/receipt-icon";

// How far back to look when nobody says otherwise. A quarter is the unit a
// bookkeeping client actually thinks in, and it keeps the first load quick.
const DEFAULT_DAYS = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export default async function MissingReceiptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string; from?: string; to?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("Quickbooks");

  const [firm, clients] = await Promise.all([
    getCurrentFirm(),
    listFirmQuickbooksConnectedClients(),
  ]);

  if (!firm || clients.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center animate-in-up">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/60 ring-1 ring-inset ring-border/50">
          <ReceiptIcon />
        </div>
        <h1 className="mt-5 text-xl font-semibold">{t("gaps_title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("gaps_not_connected")}
        </p>
        <Link
          href="/settings?tab=integrations"
          className="mt-5 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("gaps_connect_cta")}
        </Link>
      </div>
    );
  }

  // Which client's books are we looking at? First connected one by default, so
  // the page is useful on arrival rather than asking a question first.
  const selected =
    clients.find((c) => c.clientId === sp.client) ?? clients[0]!;
  const from = isIsoDate(sp.from) ? sp.from : isoDaysAgo(DEFAULT_DAYS);
  const to = isIsoDate(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);

  const ctx = await getQuickbooksReadContext(firm.id, selected.clientId);

  let scan: Awaited<ReturnType<typeof scanReceiptGaps>> | null = null;
  let scanError = false;
  if (ctx) {
    try {
      scan = await scanReceiptGaps(ctx, { from, to });
    } catch (err) {
      // "We couldn't look" must never render as "nothing to find" — that is the
      // exact reassuring-lie failure this whole feature is meant to remove.
      console.error("[missing receipts] scan failed:", err);
      scanError = true;
    }
  }

  // Engagements the client can actually upload to. A complete or cancelled one
  // refuses portal uploads, so offering it would produce a question the client
  // physically cannot answer.
  const engagements = (
    await listEngagements({ client_id: selected.clientId })
  ).filter((e) => e.status !== "complete" && e.status !== "cancelled");

  // Anything already asked about is shown as asked rather than offered again.
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
    <div className="animate-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("gaps_title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("gaps_subtitle")}
        </p>
      </header>

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
    </div>
  );
}
