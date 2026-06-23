import { getTranslations, setRequestLocale } from "next-intl/server";

// Real-time: never serve a cached version after an approve / dismiss / reopen.
export const dynamic = "force-dynamic";

import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { getFirmQuickbooksStatus } from "@/lib/db/quickbooks";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { listFirmDrafts } from "@/lib/db/quickbooks-suggestions";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { summarizeDrafts } from "@/lib/quickbooks/draft-summary";
import {
  countQueueBuckets,
  draftQueueBucket,
  parseQueueFilter,
  matchesQueueFilter,
} from "@/lib/quickbooks/draft-queue";
import { DraftsQueue } from "@/components/quickbooks/drafts-queue";
import { QueueRow } from "@/components/quickbooks/queue-row";
import type { DraftCardOptions } from "@/components/engagements/quickbooks-draft-card";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

export default async function QuickbooksDraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; client?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("Quickbooks");

  // Connection gate. The nav item is hidden until QuickBooks is connected, but
  // the page is reachable by direct URL, so show a friendly prompt either way.
  const [status, user] = await Promise.all([
    getFirmQuickbooksStatus(),
    getCurrentUser(),
  ]);
  const isOwner = user?.role === "owner";

  if (!status) {
    return (
      <div className="space-y-6">
        <Header title={t("queue_title")} subtitle={t("queue_subtitle")} />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/40 bg-muted/20 py-16 text-center">
          <BookOpen className="h-9 w-9 text-muted-foreground/50" aria-hidden="true" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {isOwner ? t("queue_connect_owner") : t("queue_connect_staff")}
          </p>
          {isOwner && (
            <Link href="/settings?tab=integrations">
              <Button size="sm" variant="secondary">
                {t("queue_connect_cta")}
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  const [rows, qboLists, firmUsers] = await Promise.all([
    listFirmDrafts(),
    readCachedQuickbooksLists(),
    listFirmUsers(),
  ]);

  const reviewerNameById = new Map(
    firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
  );
  const toOpt = (x: { id: string; name: string }) => ({ id: x.id, name: x.name });
  const options: DraftCardOptions = {
    vendors: (qboLists?.vendors ?? []).filter((x) => x.active).map(toOpt),
    customers: (qboLists?.customers ?? []).filter((x) => x.active).map(toOpt),
    accounts: (qboLists?.accounts ?? []).filter((x) => x.active).map(toOpt),
    taxCodes: (qboLists?.taxCodes ?? []).filter((x) => x.active).map(toOpt),
  };

  // Counts + pipeline total over ALL drafts (so the chips show totals
  // regardless of the active filter).
  const queueItems = rows.map((r) => ({
    suggestion: r.suggestion,
    resolved: r.resolved,
    status: r.status,
  }));
  const counts = countQueueBuckets(queueItems);
  const summary = summarizeDrafts(queueItems);

  // The clients that actually have drafts, for the client filter (deduped, A→Z).
  const clientsWithDrafts = [
    ...new Map(
      rows
        .filter((r) => r.clientId)
        .map((r) => [
          r.clientId as string,
          { id: r.clientId as string, name: r.clientName ?? t("queue_unknown_client") },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, locale === "fr" ? "fr-CA" : "en-CA"));

  const activeFilter = parseQueueFilter(sp.status);
  const activeClient =
    typeof sp.client === "string" && sp.client ? sp.client : null;

  // Server-side filter by status bucket + client (text search is client-side).
  const visibleRows = rows.filter((r) => {
    const bucket = draftQueueBucket({
      suggestion: r.suggestion,
      resolved: r.resolved,
      status: r.status,
    });
    if (!matchesQueueFilter(activeFilter, bucket)) return false;
    if (activeClient && r.clientId !== activeClient) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <Header
        title={t("queue_title")}
        subtitle={t("summary_drafts", { count: counts.total })}
      />
      <DraftsQueue
        counts={counts}
        totalCad={summary.totalCad}
        hasForeignCurrency={summary.hasForeignCurrency}
        activeFilter={activeFilter}
        activeClient={activeClient}
        clients={clientsWithDrafts}
        locale={locale}
        searchIndex={visibleRows.map((r) => ({
          id: r.fileId,
          text: `${r.clientName ?? ""} ${r.engagementTitle ?? ""} ${r.documentName ?? ""}`.toLowerCase(),
        }))}
        emptyAll={rows.length === 0}
      >
        {visibleRows.map((r) => (
          <QueueRow
            key={r.fileId}
            row={r}
            options={options}
            locale={locale}
            reviewedByName={
              r.reviewedBy ? (reviewerNameById.get(r.reviewedBy) ?? null) : null
            }
          />
        ))}
      </DraftsQueue>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 animate-in-up">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}
