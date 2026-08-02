// Month-end close — every client, one month, one screen.
//
// A tax firm has one busy season a year. A bookkeeping firm has twelve: thirty
// clients means thirty of these every month, forever. Knowing which are done,
// which are stuck and what is blocking them is most of what running the firm
// is, and until now Vylan could only answer it one client at a time.
//
// WHAT LOADS INSTANTLY AND WHAT DOES NOT. Everything from Vylan's own database
// — who is connected, what the client still owes, which months are closed —
// renders on arrival. The two ledger numbers do not: they come from reading the
// client's books live, and doing that for every client on page load would mean
// a hundred and twenty QuickBooks calls before the page drew anything. Each row
// fetches its own when asked. The board is honest about which is which.

export const dynamic = "force-dynamic";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import {
  listClosesForPeriod,
  countOpenRequestsByClient,
} from "@/lib/db/month-close";
import { isPeriodKey, defaultPeriod } from "@/lib/close/period";
import { CloseBoard } from "@/components/quickbooks/close-board";
import { ReceiptIcon } from "@/components/quickbooks/receipt-icon";

export default async function MonthEndClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
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
        <h1 className="mt-5 text-xl font-semibold">{t("close_title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("close_not_connected")}
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

  // Default to LAST month: you close July during August, and opening on the
  // current month would show one nobody can finish yet.
  const period = isPeriodKey(sp.period)
    ? sp.period
    : defaultPeriod(new Date().toISOString().slice(0, 10));

  const clientIds = clients.map((c) => c.clientId);
  const [closes, openRequests, users] = await Promise.all([
    listClosesForPeriod(period),
    countOpenRequestsByClient(clientIds),
    listFirmUsers(),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, userDisplayLabel(u)]));

  return (
    <div className="animate-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("close_title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("close_subtitle")}
        </p>
      </header>

      <CloseBoard
        period={period}
        locale={locale}
        rows={clients.map((c) => {
          const close = closes.get(c.clientId);
          return {
            clientId: c.clientId,
            name: c.clientName ?? c.companyName ?? c.clientId,
            openRequests: openRequests.get(c.clientId) ?? 0,
            closedAt: close?.closedAt ?? null,
            closedBy: close?.closedBy
              ? (nameOf.get(close.closedBy) ?? null)
              : null,
          };
        })}
      />
    </div>
  );
}
