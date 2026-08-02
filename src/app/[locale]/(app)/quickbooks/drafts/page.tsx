// Bookkeeping.
//
// This page used to BE the drafts queue, with three grey text links tucked in
// the top-right corner for the month-end close and the two ledger lists. The
// founder's objection, and it is the right one: the close is not a footnote to
// a document queue. It is the job — every client, every month, forever — and
// the queue is one of the things you work through while doing it.
//
// So the page is now two sections, in Canopy's shape (the layout #1087 already
// brought to the client and teammate pages: every section its own bordered card
// with a title band):
//
//   1. MONTH-END CLOSE, on top and full width. Its own month, its own progress,
//      every connected client in one list.
//   2. LOGS, underneath. The three working lists — documents coming in,
//      receipts missing, entries uncategorised — as tabs of one panel, because
//      all three are the same shape of work: read a list for one client and
//      clear it.
//
// ONE TAB'S DATA LOADS AT A TIME. The tab is a URL, not client state, so the
// receipts tab never pays for the drafts queue's queries and the drafts tab
// never waits on a QuickBooks ledger scan. Same reason the Files page does it
// this way.
//
// The close section costs only database reads. The two ledger numbers on it are
// still fetched per client on demand — see close-board.tsx for why that is the
// honest design rather than the slow one.

export const dynamic = "force-dynamic";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { BookOpenCheck } from "lucide-react";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { listFirmXeroConnectedClients } from "@/lib/db/xero";
import { mergeCloseClients } from "@/lib/close/clients";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import {
  listClosesForPeriod,
  countOpenRequestsByClient,
  type MonthClose,
} from "@/lib/db/month-close";
import { isPeriodKey, defaultPeriod } from "@/lib/close/period";
import { CloseBoard } from "@/components/quickbooks/close-board";
import { DocumentsTab } from "./documents-tab";
import { ReceiptsTab } from "./receipts-tab";
import { UncategorizedTab } from "./uncategorized-tab";

const TABS = ["documents", "receipts", "uncategorized"] as const;
type LogsTab = (typeof TABS)[number];

function resolveTab(v: string | undefined): LogsTab {
  return (TABS as readonly string[]).includes(v ?? "")
    ? (v as LogsTab)
    : "documents";
}

type SearchParams = {
  tab?: string;
  status?: string;
  client?: string;
  from?: string;
  to?: string;
  period?: string;
};

export default async function BookkeepingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("Quickbooks");

  const tab = resolveTab(sp.tab);

  // Default to LAST month: you close July during August, and opening on the
  // current month shows one nobody can finish yet.
  const period = isPeriodKey(sp.period)
    ? sp.period
    : defaultPeriod(new Date().toISOString().slice(0, 10));

  // BOTH ledgers. The board is "what is left to do this month", and a Xero
  // client's month is exactly as open as a QuickBooks one's — listing only
  // QuickBooks made half a mixed firm's clients silently absent from it.
  const [firm, qboClients, xeroClients] = await Promise.all([
    getCurrentFirm(),
    listFirmQuickbooksConnectedClients(),
    listFirmXeroConnectedClients(),
  ]);
  const connectedClients = mergeCloseClients(qboClients, xeroClients);

  // The close section's data — database reads only, so it never delays the page
  // on a ledger call.
  const clientIds = connectedClients.map((c) => c.clientId);
  const [closes, openRequests, users] =
    firm && clientIds.length > 0
      ? await Promise.all([
          listClosesForPeriod(period),
          countOpenRequestsByClient(clientIds),
          listFirmUsers(),
        ])
      : [
          new Map<string, MonthClose>(),
          new Map<string, number>(),
          [] as Awaited<ReturnType<typeof listFirmUsers>>,
        ];
  const nameOf = new Map(users.map((u) => [u.id, userDisplayLabel(u)]));

  const closedCount = connectedClients.filter((c) =>
    closes.has(c.clientId),
  ).length;

  const tabs: { id: LogsTab; label: string }[] = [
    { id: "documents", label: t("bk_tab_documents") },
    { id: "receipts", label: t("gaps_title") },
    { id: "uncategorized", label: t("uncat_title") },
  ];

  // Tab links carry the month so switching a tab never resets the close section
  // above them. Everything else (client, dates) is per-tab and deliberately not
  // carried across.
  const hrefFor = (id: LogsTab) =>
    `/quickbooks/drafts?tab=${id}${sp.period ? `&period=${sp.period}` : ""}`;

  return (
    <div className="flex flex-col gap-5 animate-in-up">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <BookOpenCheck
            className="h-6 w-6 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("bk_title")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("bk_subtitle")}</p>
      </header>

      {/* ── The close. Top of the page, its own section, not a tab. ────── */}
      {connectedClients.length > 0 && (
        <Panel
          title={t("close_title")}
          aside={t("close_progress", {
            closed: closedCount,
            total: connectedClients.length,
          })}
        >
          <CloseBoard
            period={period}
            locale={locale}
            rows={connectedClients.map((c) => {
              const close = closes.get(c.clientId);
              return {
                clientId: c.clientId,
                name: c.name,
                provider: c.provider,
                openRequests: openRequests.get(c.clientId) ?? 0,
                closedAt: close?.closedAt ?? null,
                closedBy: close?.closedBy
                  ? (nameOf.get(close.closedBy) ?? null)
                  : null,
              };
            })}
          />
        </Panel>
      )}

      {/* ── The logs. Three lists, one panel, one tab strip. ───────────── */}
      <Panel
        title={t("bk_logs_title")}
        tabs={
          <nav
            aria-label={t("bk_logs_title")}
            className="flex items-center gap-1"
          >
            {tabs.map((item) => {
              const active = item.id === tab;
              return (
                <Link
                  key={item.id}
                  href={hrefFor(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-[11px] border-b-2 px-2.5 pb-2.5 text-sm transition-colors",
                    active
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        }
      >
        {tab === "receipts" ? (
          <ReceiptsTab locale={locale} sp={sp} />
        ) : tab === "uncategorized" ? (
          <UncategorizedTab sp={sp} />
        ) : (
          <DocumentsTab locale={locale} sp={sp} />
        )}
      </Panel>
    </div>
  );
}

// A titled box. Canopy's whole page is these — every section, however small, is
// its own bordered card with a header band, which is what makes a dense page
// readable instead of a wall. Same shape as the client page (#1087).
function Panel({
  title,
  aside,
  tabs,
  children,
}: {
  title: string;
  aside?: string;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {tabs}
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}
