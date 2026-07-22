import { getTranslations, setRequestLocale } from "next-intl/server";

// Real-time: never serve a cached version after an approve / dismiss / reopen.
export const dynamic = "force-dynamic";

import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksScopeHealth } from "@/lib/quickbooks/connection";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { listFirmDrafts } from "@/lib/db/quickbooks-suggestions";
import { readCachedQuickbooksListsByClient } from "@/lib/db/quickbooks-cache";
import { readCachedXeroLists } from "@/lib/db/xero-cache";
import { filterXeroConnectedClientIds } from "@/lib/db/xero";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import { summarizeDrafts } from "@/lib/quickbooks/draft-summary";
import { isSelectableTaxCode } from "@/lib/quickbooks/tax-code";
import {
  countQueueBuckets,
  draftQueueBucket,
  parseQueueFilter,
  matchesQueueFilter,
  bucketRank,
  queueHealthScopes,
} from "@/lib/quickbooks/draft-queue";
import { DraftsQueue } from "@/components/quickbooks/drafts-queue";
import { QueueRow } from "@/components/quickbooks/queue-row";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import type { DraftCardOptions } from "@/components/engagements/quickbooks-draft-card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  UploadCloud,
} from "lucide-react";

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
  const [connected, user, firm] = await Promise.all([
    firmHasAnyQuickbooksConnection(),
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  const isOwner = user?.role === "owner";

  if (!connected) {
    // Not-connected state = a welcoming CONNECT prompt (not a bare empty box).
    // Reachable via the sidebar (owners see Integrations even before connecting)
    // or by direct URL. Owners get a primary "Connect QuickBooks" CTA into
    // Settings -> Integrations (where the real connect flow + errors live);
    // staff get a calm "ask your owner" note. "Mesh, don't box": a centered
    // hero, hairline-separated "how it works" row, no hard card border.
    const steps = [
      {
        icon: UploadCloud,
        color: "text-icon-blue",
        title: t("queue_connect_step1_title"),
        desc: t("queue_connect_step1_desc"),
      },
      {
        icon: Sparkles,
        color: "text-icon-purple",
        title: t("queue_connect_step2_title"),
        desc: t("queue_connect_step2_desc"),
      },
      {
        icon: CheckCircle2,
        color: "text-icon-emerald",
        title: t("queue_connect_step3_title"),
        desc: t("queue_connect_step3_desc"),
      },
    ];
    return (
      <div className="mx-auto max-w-2xl py-10 text-center animate-in-up sm:py-16">
        {/* Brand mark on a soft QuickBooks-green tile — the logo keeps its real
            brand color; the tint ties the page to QuickBooks without a border. */}
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[#2CA01C]/10 ring-1 ring-inset ring-[#2CA01C]/20">
          <QuickbooksLogo className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t("queue_connect_headline")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("queue_connect_owner")}
        </p>

        {isOwner ? (
          <div className="mt-7">
            {/* Connecting is PER CLIENT (0710): open a client's page and connect
                their QuickBooks there. Send the owner to the clients list. */}
            <Button asChild size="lg" className="gap-2">
              <Link href="/clients">
                <QuickbooksLogo className="h-4 w-4" />
                {t("queue_connect_cta_clients")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mx-auto mt-7 max-w-md rounded-xl bg-muted/30 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {t("queue_connect_staff")}
            </p>
          </div>
        )}

        {/* How it works — three plain steps, no boxes; a hairline sets them off. */}
        <div className="mt-12 border-t border-border/40 pt-8 text-left">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            {t("queue_connect_steps_label")}
          </p>
          <ol className="mt-5 grid gap-7 sm:grid-cols-3 sm:gap-5">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={i}
                  className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/60">
                    <Icon className={`size-5 ${step.color}`} aria-hidden />
                  </span>
                  <div className="space-y-1">
                    <div className="text-sm font-medium leading-snug">
                      {step.title}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {step.desc}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  }

  const [rows, firmUsers] = await Promise.all([
    listFirmDrafts(),
    listFirmUsers(),
  ]);

  // Per-client (0710): picker lists load for every draft-bearing client (posted
  // rows still render cards), but the HEALTH probe covers only clients whose
  // drafts still await posting — a settled (posted/dismissed) row's connection
  // may be legitimately retired, and probing it showed a permanent false
  // "reconnect" banner on queues with nothing left to post.
  //
  // 0790: the queue now mixes QuickBooks and Xero drafts. Split the draft-bearing
  // clients by provider so each row's pickers load from the RIGHT product's cache
  // (QBO clients from the batched QuickBooks read, Xero clients from their Xero
  // cache). The connection-health probe is QuickBooks-only (Xero posting is Phase
  // 4), so it must never run against a Xero client — filter those out before
  // scoping it, or a Xero row would falsely trip the "connect this client" notice.
  // EFFECTIVE provider per row from the LIVE Xero connection, not just the
  // stored `provider` column: before migration 0790 lands that column is absent
  // and every row reads 'quickbooks', which would mis-brand a mixed firm's Xero
  // drafts and trip a false QuickBooks reconnect banner. A row is Xero if its
  // stored provider says so OR its client is live-Xero-connected.
  const draftClientIds = [
    ...new Set(rows.map((r) => r.clientId).filter((c): c is string => !!c)),
  ];
  const liveXeroClients = await filterXeroConnectedClientIds(draftClientIds);
  const effProvider = (r: {
    provider: "quickbooks" | "xero";
    clientId: string | null;
  }): "quickbooks" | "xero" =>
    r.provider === "xero" || (r.clientId ? liveXeroClients.has(r.clientId) : false)
      ? "xero"
      : "quickbooks";

  const qboClientIdsWithDrafts = [
    ...new Set(
      rows
        .filter((r) => effProvider(r) !== "xero")
        .map((r) => r.clientId)
        .filter((c): c is string => !!c),
    ),
  ];
  const xeroClientIdsWithDrafts = [
    ...new Set(
      rows
        .filter((r) => effProvider(r) === "xero")
        .map((r) => r.clientId)
        .filter((c): c is string => !!c),
    ),
  ];
  const healthScopes = queueHealthScopes(
    rows.filter((r) => effProvider(r) !== "xero"),
  );

  // Connection health + the per-client picker lists load together. Health: a
  // DEAD connection (expired/revoked tokens) gets a "reconnect" banner, and a
  // MISSING one (client never connected / disconnected since) gets a softer
  // "connect this client" notice, instead of letting every post fail with no
  // explanation; the alert shows if ANY open-draft connection is unusable, and
  // a dead one outranks a missing one. Capped at 3s — a stale token makes the
  // check call Intuit, and this page must never wait on a slow upstream (the
  // un-awaited check still finishes the keep-alive refresh in background; an
  // inconclusive check just reports "ok", i.e. no banner this load). Lists: one
  // batched read (5 queries total) so a many-client queue doesn't fan out.
  const HEALTH_BUDGET_MS = 3000;
  const [listsByClient, xeroListsByClient, health] = await Promise.all([
    readCachedQuickbooksListsByClient(qboClientIdsWithDrafts),
    // Xero has no batched by-client reader; load each distinct Xero client's
    // cache in parallel and stitch into a map (mirrors the QBO map shape). A
    // client with no cached rows / pre-0780 yields null → empty pickers.
    Promise.all(
      xeroClientIdsWithDrafts.map(
        async (cid) => [cid, await readCachedXeroLists(cid)] as const,
      ),
    ).then(
      (entries) =>
        new Map<string, QuickbooksLists | null>(
          entries.map(([cid, lists]) => [cid, lists]),
        ),
    ),
    firm && healthScopes.length > 0
      ? Promise.race([
          Promise.all(
            healthScopes.map((cid) => getQuickbooksScopeHealth(firm.id, cid)),
          ).then((hs) =>
            hs.includes("reconnect_required")
              ? ("reconnect_required" as const)
              : hs.includes("not_connected")
                ? ("not_connected" as const)
                : ("ok" as const),
          ),
          new Promise<"ok">((resolve) =>
            setTimeout(() => resolve("ok"), HEALTH_BUDGET_MS),
          ),
        ])
      : Promise.resolve("ok" as const),
  ]);

  const reviewerNameById = new Map(
    firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
  );
  const toOpt = (x: { id: string; name: string }) => ({
    id: x.id,
    name: x.name,
  });
  const isPayFrom = (t: string | null) =>
    ["bank", "credit card"].includes((t ?? "").toLowerCase());
  const buildOptions = (qboLists: QuickbooksLists | null): DraftCardOptions => ({
    vendors: (qboLists?.vendors ?? []).filter((x) => x.active).map(toOpt),
    customers: (qboLists?.customers ?? []).filter((x) => x.active).map(toOpt),
    accounts: (qboLists?.accounts ?? []).filter((x) => x.active).map(toOpt),
    // Exclude QuickBooks "adjustment" tax codes: they have no purchase/sales rate
    // and QuickBooks rejects them on a transaction (tax-calc ValidationFault 6000).
    taxCodes: (qboLists?.taxCodes ?? [])
      .filter((x) => x.active && isSelectableTaxCode(x.name))
      .map(toOpt),
    items: (qboLists?.items ?? []).filter((x) => x.active).map(toOpt),
    paymentAccounts: (qboLists?.accounts ?? [])
      .filter((x) => x.active && isPayFrom(x.accountType))
      .map(toOpt),
  });
  // One options set per client (built from that client's cached lists), plus an
  // empty fallback for a row whose client didn't resolve. Each queue row picks
  // its own client's options below.
  const EMPTY_OPTIONS: DraftCardOptions = {
    vendors: [],
    customers: [],
    accounts: [],
    taxCodes: [],
    items: [],
    paymentAccounts: [],
  };
  const optionsByClient = new Map<string, DraftCardOptions>(
    [...listsByClient].map(([cid, lists]) => [cid, buildOptions(lists)]),
  );
  // Merge in the Xero clients' options (built from their Xero cache, which the
  // adapter already shaped as QuickbooksLists). A client is at most one provider,
  // so these keys never collide with the QuickBooks ones above.
  for (const [cid, lists] of xeroListsByClient) {
    optionsByClient.set(cid, buildOptions(lists));
  }
  const optionsFor = (clientId: string | null): DraftCardOptions =>
    (clientId ? optionsByClient.get(clientId) : undefined) ?? EMPTY_OPTIONS;

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
          {
            id: r.clientId as string,
            name: r.clientName ?? t("queue_unknown_client"),
          },
        ]),
    ).values(),
  ].sort((a, b) =>
    a.name.localeCompare(b.name, locale === "fr" ? "fr-CA" : "en-CA"),
  );

  const activeFilter = parseQueueFilter(sp.status);
  const activeClient =
    typeof sp.client === "string" && sp.client ? sp.client : null;

  // Compute each row's bucket once, then filter + sort.
  const withBucket = rows.map((r) => ({
    r,
    bucket: draftQueueBucket({
      suggestion: r.suggestion,
      resolved: r.resolved,
      status: r.status,
    }),
  }));

  // Ready drafts for the active client filter — what "Approve all ready" covers.
  const readyCount = withBucket.filter(
    (x) =>
      x.bucket === "ready" && (!activeClient || x.r.clientId === activeClient),
  ).length;

  // Approved expense + income drafts for the active client filter — what "Post
  // all approved" covers (unknown-direction / unposted-only are excluded).
  // QuickBooks ONLY (0790): Xero posting is Phase 4, so a Xero draft is never
  // counted here and the bulk-post button never targets it.
  const postableCount = withBucket.filter(
    (x) =>
      x.bucket === "approved" &&
      effProvider(x.r) !== "xero" &&
      (x.r.suggestion.direction === "expense" ||
        x.r.suggestion.direction === "income") &&
      !x.r.postedQboId &&
      (!activeClient || x.r.clientId === activeClient),
  ).length;

  // Server-side filter by status bucket + client (text search is client-side),
  // then a priority sort so what needs attention leads (newest-first within each
  // bucket is preserved by the stable sort over the already newest-first rows).
  const visibleRows = withBucket
    .filter(
      (x) =>
        matchesQueueFilter(activeFilter, x.bucket) &&
        (!activeClient || x.r.clientId === activeClient),
    )
    .sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket))
    .map((x) => x.r);

  return (
    <div className="space-y-6">
      <Header
        title={t("queue_title")}
        subtitle={t("summary_drafts", { count: counts.total })}
      />
      {health === "reconnect_required" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] px-4 py-3 animate-in-up"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {isOwner
              ? t("queue_reconnect_owner")
              : t("queue_reconnect_staff")}
          </p>
          {isOwner && (
            // Reconnecting is per client now — it lives on the client's page.
            <Button asChild size="sm" variant="outline">
              <Link href="/clients">{t("queue_reconnect_cta")}</Link>
            </Button>
          )}
        </div>
      )}
      {health === "not_connected" && (
        // Softer than the reconnect alert: nothing expired — a client with
        // open drafts simply has no QuickBooks connection to post through.
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-secondary/40 px-4 py-3 animate-in-up">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {isOwner
              ? t("queue_not_connected_owner")
              : t("queue_not_connected_staff")}
          </p>
          {isOwner && (
            <Button asChild size="sm" variant="outline">
              <Link href="/clients">{t("queue_connect_cta")}</Link>
            </Button>
          )}
        </div>
      )}
      <DraftsQueue
        counts={counts}
        readyCount={readyCount}
        postableCount={postableCount}
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
            options={optionsFor(r.clientId)}
            provider={effProvider(r)}
            locale={locale}
            reviewedByName={
              r.reviewedBy ? (reviewerNameById.get(r.reviewedBy) ?? null) : null
            }
            postedByName={
              r.postedBy ? (reviewerNameById.get(r.postedBy) ?? null) : null
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
        <div className="flex items-center gap-2.5">
          <QuickbooksLogo className="h-7 w-7 shrink-0" />
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}
