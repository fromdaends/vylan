// Not categorised — what is sitting in a client's books that nobody has coded.
//
// Sibling of the missing-receipts screen, and the other half of the same idea:
// that one asks which entries have no paper behind them, this one asks which
// have no meaning behind them. Both read the ledger and hand the firm a list of
// things to finish, which is what a month-end close actually is.
//
// The difference is that this screen can FIX what it finds. Pick the account,
// press apply, and the client's books change — nobody opens QuickBooks.
//
// Always live, never cached: the moment anyone codes a transaction, in Vylan or
// in QuickBooks itself, the answer changes.

export const dynamic = "force-dynamic";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
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
import { ReceiptIcon } from "@/components/quickbooks/receipt-icon";

// How far back to look when nobody says otherwise. A quarter is the unit a
// bookkeeping client thinks in, and it keeps the first load quick.
const DEFAULT_DAYS = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export default async function UncategorizedPage({
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
        <h1 className="mt-5 text-xl font-semibold">{t("uncat_title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("uncat_not_connected")}
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

  const selected = clients.find((c) => c.clientId === sp.client) ?? clients[0]!;
  const from = isIsoDate(sp.from) ? sp.from : isoDaysAgo(DEFAULT_DAYS);
  const to = isIsoDate(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);

  const ctx = await getQuickbooksReadContext(firm.id, selected.clientId);

  let scan: Awaited<ReturnType<typeof scanUncategorized>> | null = null;
  let accounts: LedgerAccount[] = [];
  let scanError = false;
  if (ctx) {
    try {
      // One account read feeds both the scan and the picker — the scan needs to
      // know which accounts are parking accounts, the picker needs the rest.
      accounts = await readAccounts(ctx);
      scan = await scanUncategorized(ctx, { from, to, accounts });
    } catch (err) {
      // "We couldn't look" must never render as "nothing to code" — that is the
      // reassuring lie this whole screen exists to remove.
      console.error("[uncategorized] scan failed:", err);
      scanError = true;
    }
  }

  const parkingIds = new Set((scan?.parkingAccounts ?? []).map((a) => a.id));

  // Engagements the client can actually answer on. A complete or cancelled one
  // refuses portal activity, so offering it would produce a question the client
  // physically cannot answer.
  const engagements = (
    await listEngagements({ client_id: selected.clientId })
  ).filter((e) => e.status !== "complete" && e.status !== "cancelled");

  // What has already been asked, and anything the client has since said.
  const answers = await ledgerAnswersForClient(selected.clientId);

  return (
    <div className="animate-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("uncat_title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("uncat_subtitle")}
        </p>
      </header>

      <UncategorizedList
        clients={clients.map((c) => ({
          id: c.clientId,
          name: c.clientName ?? c.companyName ?? c.clientId,
        }))}
        selectedClientId={selected.clientId}
        from={from}
        to={to}
        txns={scan?.txns ?? []}
        considered={scan?.considered ?? 0}
        truncated={scan?.truncated ?? false}
        scanFailed={scanError || !ctx}
        parkingAccounts={(scan?.parkingAccounts ?? []).map((a) => a.name)}
        // Everything the firm may move a line ONTO: active, and not itself a
        // parking account.
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
    </div>
  );
}
