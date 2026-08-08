import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getClient, listClients } from "@/lib/db/clients";
import { clientVisibility } from "@/lib/clients/visibility";
import { listRelationshipsForClient } from "@/lib/db/relationships";
import { resolveRelationshipRows } from "@/lib/relationships/validate";
import {
  RelationshipsCard,
  type RelationshipCardRow,
} from "@/components/clients/relationships-card";
import { listEngagements } from "@/lib/db/engagements";
import {
  loadEngagementSignals,
  loadEngagementWorklist,
} from "@/lib/dashboard/worklist";
import { selectForClient } from "@/lib/dashboard/worklist-select";
import { selectView, viewLabelKey } from "@/lib/engagements/views";
import { WorklistBrowser } from "@/components/dashboard/worklist-browser";
import { FilterLinks } from "@/components/ui/filter-links";
import { deriveEngagementStatus } from "@/lib/attention";
import { getCurrentFirm } from "@/lib/db/firms";
import { findClientPortalDoor } from "@/lib/db/portal";
import { PortalDoorLink } from "@/components/portal/portal-door-link";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { listClientMembers } from "@/lib/db/client-members";
import { ClientAccess } from "@/components/clients/client-access";
import { ClientNotes } from "@/components/clients/client-notes";
import { StatusCapsule } from "@/components/ui/status-capsule";
import { listClientNotes } from "@/lib/db/client-notes";
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { fieldLabel, INDUSTRIES, PROVINCES } from "@/lib/clients/fields";
// PLAIN module, not a "use client" one: this Server Component CALLS these, and
// a client-module export would be a client reference that throws (#959).
import {
  parseClientTab,
  clientTabHref,
  parseClientEngagementView,
  CLIENT_ENGAGEMENT_VIEWS,
  clientEngagementViewHref,
  type ClientEngagementView,
  parseClientBookkeepingView,
  CLIENT_BOOKKEEPING_VIEWS,
  clientBookkeepingViewHref,
} from "@/lib/clients/tabs";
import { listDocuments } from "@/lib/db/documents";
// The SAME browser /files renders. Not a client-scoped copy of it — see the
// Files tab below and the repo's Cohesion rule.
import { BrowseTab } from "@/components/files/browse-tab";
import { hasActiveTeam } from "@/lib/team/mode";
import { ClientAssignee } from "@/components/clients/client-assignee";
import { ClientNameMenu } from "@/components/clients/client-name-menu";
import { ClientLocked } from "@/components/clients/client-locked";
import {
  getLatestPaymentStatusByEngagementIds,
  listFirmPaymentsWithNames,
} from "@/lib/db/payment-requests";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import { shouldReconcile } from "@/lib/reconcile-throttle";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/payments/payment-badge";
import { RecurringBadge } from "@/components/engagements/recurring-badge";
import { PaymentsList } from "@/components/payments/payments-list";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import { assertLocale } from "@/lib/locale";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, Lock, FileText, Clock } from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { BackLink } from "@/components/ui/back-link";
import { Panel } from "@/components/ui/panel";
import { ProfileTabs } from "@/components/ui/profile-tabs";
import { cn } from "@/lib/cn";
import { STAGE_BG_CLASS } from "@/lib/engagements/stage";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { getBrandingImageUrl } from "@/lib/storage";
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { listEntriesForClient } from "@/lib/db/time-entries";
import { dateInTimeZone, todayInTimeZone } from "@/lib/tasks/dates";
import { listBillableRates, valueCents } from "@/lib/db/time-billing";
import { formatMinutes } from "@/lib/time/duration";
import { getClientQuickbooksStatus } from "@/lib/db/quickbooks";
import { getQuickbooksConnectionHealth } from "@/lib/quickbooks/connection";
import {
  isQuickbooksConfigured,
  quickbooksEnvironment,
} from "@/lib/quickbooks/client";
import { ClientQuickbooksCard } from "@/components/clients/client-quickbooks-card";
import { getClientXeroStatus } from "@/lib/db/xero";
import { getXeroConnectionHealth } from "@/lib/xero/connection";
import { isXeroConfigured } from "@/lib/xero/client";
import { ClientXeroCard } from "@/components/clients/client-xero-card";
import { ClientPortalPinCard } from "@/components/clients/client-portal-pin-card";
// ── The Bookkeeping tab ──────────────────────────────────────────────────────
// The SAME close board and the SAME two working lists the firm-wide
// Bookkeeping page renders, scoped to this client — not client-shaped copies of
// them. See the repo's Cohesion rule, and the Files tab above for the identical
// treatment of the file browser.
import { CloseBoard } from "@/components/quickbooks/close-board";
import { ReceiptsTab } from "@/app/[locale]/(app)/quickbooks/drafts/receipts-tab";
import { UncategorizedTab } from "@/app/[locale]/(app)/quickbooks/drafts/uncategorized-tab";
import {
  listClosesForPeriod,
  countOpenRequestsByClient,
} from "@/lib/db/month-close";
import { isPeriodKey, defaultPeriod } from "@/lib/close/period";

// Shared by the hidden archive/restore form and the ⋯ menu item that submits it.
const CLIENT_ARCHIVE_FORM_ID = "client-archive-form";

// How many engagements the OVERVIEW shows before deferring to the tab. Five is
// the same cut the Recent files card takes, so the two summary cards on the
// overview stay the same height as each other.
const OVERVIEW_ENGAGEMENT_PREVIEW = 5;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  // Open-ended because the Files tab hosts the firm's file browser, which owns
  // its own set of params (folder / year / category / q / type / status / sort /
  // page). Naming them all here would mean this signature has to be edited every
  // time that browser grows one.
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale: rawLocale, id } = await params;
  const sp = await searchParams;
  const {
    qbo: qboParam,
    xero: xeroParam,
    tab: tabParam,
    ev: evParam,
    bk: bkParam,
    period: periodParam,
  } = sp;
  // Which facet of this client we are looking at. The tab is a URL rather than
  // client state, so a tab is linkable, opens in a new tab, and the back
  // button works — and each tab's data loads only when that tab is asked for.
  const tab = parseClientTab(tabParam);
  // The Engagements tab's lifecycle slice. Server-side, because Archived is a
  // different database scope — see the note on CLIENT_ENGAGEMENT_VIEWS.
  const engView = parseClientEngagementView(evParam);
  // The Bookkeeping tab's working list, and which month its close board shows.
  // Both live in the URL for the same reason the tab does: which list is open
  // decides which live ledger scan runs, so it cannot be component state.
  const bkView = parseClientBookkeepingView(bkParam);
  const period = isPeriodKey(periodParam)
    ? periodParam
    : // Last month, not this one: you close July during August, and opening on a
      // month nobody can finish yet is the firm-wide board's default too.
      defaultPeriod(new Date().toISOString().slice(0, 10));
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const client = await getClient(id);
  if (!client) notFound();

  // The client's picture (1530). Stored as a PATH and signed on read — never
  // throws (getBrandingImageUrl is fail-soft by contract), so a stale or
  // unsignable path degrades to initials rather than 500ing the profile.
  const clientAvatarUrl = await getBrandingImageUrl(client.avatar_path ?? null);

  // ── The middle privacy level (migration 1280) ────────────────────────────
  //
  // RLS let us READ this row for one of two very different reasons: either the
  // viewer is entitled to the client, or the client is 'listed' and the whole
  // firm can see that it exists. Those look identical from here, so the page
  // has to ask the second question itself.
  //
  // Done BEFORE every other fetch on purpose. A locked viewer must not pay for
  // the relationships query, the Stripe reconcile or the provider health
  // probes — and, more importantly, must never have them run at all.
  const viewer = await getCurrentUser();
  const listedCast =
    clientVisibility(client) === "listed" ? await listClientMembers(id) : [];
  const mayOpen =
    clientVisibility(client) !== "listed" ||
    viewer?.role === "owner" ||
    (viewer != null && client.assigned_user_id === viewer.id) ||
    listedCast.some((m) => m.userId === viewer?.id);

  if (!mayOpen) {
    const tCommonLocked = await getTranslations("Common");
    const tAppLocked = await getTranslations("App");
    const roster = await listFirmUsers();
    const nameOf = new Map(roster.map((u) => [u.id, userDisplayLabel(u)]));
    // The assignee first — they are the person actually accountable — then
    // everyone else on the list, in the order they were added.
    const ordered = [
      ...listedCast.filter((m) => m.userId === client.assigned_user_id),
      ...listedCast.filter((m) => m.userId !== client.assigned_user_id),
    ];
    return (
      <ClientLocked
        clientName={client.display_name}
        breadcrumbLabel={tCommonLocked("breadcrumb")}
        clientsLabel={tAppLocked("nav_clients")}
        people={ordered
          .filter((m) => nameOf.has(m.userId))
          .map((m) => ({
            id: m.userId,
            name: nameOf.get(m.userId)!,
            position: m.position,
          }))}
      />
    );
  }

  // Everything below is tab-gated exactly as before, but fanned out in ONE
  // parallel batch instead of the strict await-chain this page used to run
  // (~11-14 sequential round trips on the overview against the remote
  // database). Each thunk keeps its own gate and chains its own dependents;
  // getCurrentFirm / listFirmUsers / the signal loads are React.cache'd, so
  // thunks that need them share one query no matter how many ask.
  const needsMoney = tab === "overview" || tab === "engagements";
  const onEngagementsTab = tab === "engagements";
  const [
    relationshipData,
    engagementData,
    firm,
    firmUsers,
    moneyData,
    castRows,
    organizerWorklist,
    activeClientRows,
    archivedClientRows,
    clientNotes,
    clientTasks,
    recentFiles,
    bookkeeping,
    clientTimeEntries,
    portalDoor,
  ] = await Promise.all([
    // Relationships card data: this client's live links, plus the firm roster
    // of clients — archived included so a link's NAME still resolves even when
    // its other end is archived (the picker re-filters to live clients only).
    // OVERVIEW ONLY: the relationships card is the only thing that reads
    // these, and listClients pulls the firm's WHOLE roster — an expensive
    // query to run on a tab that shows a file list.
    tab === "overview"
      ? Promise.all([
          listRelationshipsForClient(client.id),
          listClients({ includeArchived: true }),
        ])
      : ([[], []] as [
          Awaited<ReturnType<typeof listRelationshipsForClient>>,
          Awaited<ReturnType<typeof listClients>>,
        ]),
    // OVERVIEW only. The Engagements tab reads the worklist below instead — it
    // needs progress, attention reasons and presence, none of which a raw
    // engagement row carries. Signals are CLIENT-SCOPED: the pills only
    // decorate this client's rows, and the firm-wide load was the single
    // heaviest thing this page did.
    (async () => {
      const engagements =
        tab === "overview" ? await listEngagements({ client_id: id }) : [];
      const signals =
        engagements.length > 0 ? await loadEngagementSignals("active", id) : [];
      return { engagements, signals };
    })(),
    getCurrentFirm(),
    // Team roster for the owner picker. Include deactivated members so a
    // former owner's name still renders (with a "please reassign" nudge);
    // only ACTIVE members are valid reassignment targets.
    listFirmUsers(),
    // ── Money. OVERVIEW AND ENGAGEMENTS ONLY. ────────────────────────────
    // One payments read (this used to run twice: once to find what to
    // reconcile, once again for the history panel), the Stripe self-heal on
    // still-"requested" rows — throttled, so tab switches and refreshes stop
    // re-calling Stripe for an invoice that is simply still unpaid — then a
    // re-read ONLY when a reconcile actually changed something.
    (async () => {
      if (!needsMoney) {
        return {
          clientPayments: [] as Awaited<
            ReturnType<typeof listFirmPaymentsWithNames>
          >,
          paymentByEng: new Map() as Awaited<
            ReturnType<typeof getLatestPaymentStatusByEngagementIds>
          >,
        };
      }
      const currentFirm = await getCurrentFirm();
      const connectedAccountId = currentFirm?.stripe_connect_account_id ?? null;
      let payments = await listFirmPaymentsWithNames({ clientId: id });
      if (connectedAccountId) {
        const changes = await Promise.all(
          payments
            .filter(
              (p) =>
                p.status === "requested" && shouldReconcile(`stripe:${p.id}`),
            )
            .map(async (p) => {
              const status = await reconcilePaymentRequest(
                p.id,
                connectedAccountId,
              );
              return status != null && status !== p.status;
            }),
        );
        if (changes.some(Boolean)) {
          payments = await listFirmPaymentsWithNames({ clientId: id });
        }
      }
      // Payment status per engagement (for the chip) — overview-only read: the
      // Engagements tab's rows carry their own payment status from the
      // worklist loader, and the history panel only renders on the overview.
      const paymentByEng =
        tab === "overview"
          ? await getLatestPaymentStatusByEngagementIds(
              (await listEngagements({ client_id: id })).map((e) => e.id),
            )
          : (new Map() as Awaited<
              ReturnType<typeof getLatestPaymentStatusByEngagementIds>
            >);
      return {
        clientPayments: tab === "overview" ? payments : [],
        paymentByEng,
      };
    })(),
    // Phase 3 slice 1: who works on this client. Descriptive only — nothing
    // reads it for access control yet (see 1210_client_members.sql).
    // ORGANIZERS ONLY — the one tab that lists them.
    tab === "organizers"
      ? listClientMembers(id)
      : Promise.resolve([] as Awaited<ReturnType<typeof listClientMembers>>),
    // The Organizers tab's live-count column reads the active worklist —
    // React.cache'd per scope. Team-gated inside the thunk (the roster +
    // firm reads it needs are cache-shared with the destructured ones).
    (async () => {
      if (tab !== "organizers") return [];
      const [f, users] = await Promise.all([getCurrentFirm(), listFirmUsers()]);
      const team = hasActiveTeam({
        teamEnabled: f?.team_enabled === true,
        activeMemberCount: users.filter((u) => !u.deactivated_at).length,
      });
      return team ? loadEngagementWorklist("active") : [];
    })(),
    // ── The Engagements tab's rows ─────────────────────────────────────────
    // The SAME worklist every other engagement list in the app is built from,
    // narrowed to this client. Two scopes at most: the active set plus, only
    // when you are actually on it, the archived set.
    onEngagementsTab
      ? loadEngagementWorklist("active").then((rows) =>
          selectForClient(rows, id),
        )
      : Promise.resolve([] as ReturnType<typeof selectForClient>),
    onEngagementsTab && engView === "archived"
      ? loadEngagementWorklist("archived").then((rows) =>
          selectForClient(rows, id),
        )
      : Promise.resolve([] as ReturnType<typeof selectForClient>),
    // The client's attributed notes (1270). Overview only — nothing else on
    // the page shows them. Fails soft on its own: listClientNotes returns []
    // when the migration hasn't landed.
    tab === "overview"
      ? listClientNotes(id)
      : Promise.resolve([] as Awaited<ReturnType<typeof listClientNotes>>),
    // THIS CLIENT'S TASKS. Read through the shared task list rather than a
    // client-specific query, per the Tasks rule in CLAUDE.md: a task created on
    // an engagement and a task created straight on the client are one list, and
    // this card is a VIEW of it. Filtered here rather than in the reader so
    // this page adds nothing to the tasks module while it is being built.
    // Fails soft — the tasks migrations may not be applied yet.
    tab === "overview"
      ? listFirmTasks()
          .then((rows) => rows.filter((r) => r.clientId === id))
          .catch(() => [] as Awaited<ReturnType<typeof listFirmTasks>>)
      : Promise.resolve([] as Awaited<ReturnType<typeof listFirmTasks>>),
    // The overview's "Recent files" card. Fails soft: the Files view is gated
    // on its own migration, and a client profile must not 500 because that is
    // unapplied.
    tab === "overview"
      ? listDocuments({ clientId: id, sort: "date", page: 1 })
          .then((page) => page.documents.slice(0, 5))
          .catch(
            () => [] as Awaited<ReturnType<typeof listDocuments>>["documents"],
          )
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof listDocuments>>["documents"],
        ),
    // Per-client bookkeeping connection status + health for the cards below.
    // BOOKKEEPING TAB ONLY — the health probes are live calls out to the
    // ledger. The two providers now probe in PARALLEL (status → health chained
    // per provider); they used to run strictly one after the other.
    (async () => {
      if (tab !== "bookkeeping") {
        return {
          qboStatus: null as Awaited<
            ReturnType<typeof getClientQuickbooksStatus>
          >,
          qboHealth: "ok" as Awaited<
            ReturnType<typeof getQuickbooksConnectionHealth>
          >,
          xeroStatus: null as Awaited<ReturnType<typeof getClientXeroStatus>>,
          xeroHealth: "ok" as Awaited<
            ReturnType<typeof getXeroConnectionHealth>
          >,
          closedAt: null as string | null,
          closedBy: null as string | null,
          openRequests: 0,
        };
      }
      const currentFirm = await getCurrentFirm();
      const [qbo, xero, close] = await Promise.all([
        (async () => {
          const status = await getClientQuickbooksStatus(client.id);
          const health =
            currentFirm && status?.connected
              ? await getQuickbooksConnectionHealth(currentFirm.id, client.id)
              : ("ok" as const);
          return { status, health };
        })(),
        (async () => {
          const status = await getClientXeroStatus(client.id);
          // Health only probes when connected (it doubles as the keep-alive
          // for Xero's 60-day idle expiry).
          const health =
            currentFirm && status?.connected
              ? await getXeroConnectionHealth(currentFirm.id, client.id)
              : ("ok" as const);
          return { status, health };
        })(),
        // The month-end close for THIS client, in the month on screen.
        // Database reads only — the two ledger figures on the board are still
        // fetched on demand behind its "Check" button, which is what keeps a
        // blank cell honestly meaning "nobody has looked" instead of "clean".
        (async () => {
          const [closes, openByClient] = await Promise.all([
            listClosesForPeriod(period),
            countOpenRequestsByClient([client.id]),
          ]);
          const row = closes.get(client.id);
          return {
            closedAt: row?.closedAt ?? null,
            closedBy: row?.closedBy ?? null,
            openRequests: openByClient.get(client.id) ?? 0,
          };
        })(),
      ]);
      return {
        qboStatus: qbo.status,
        qboHealth: qbo.health,
        xeroStatus: xero.status,
        xeroHealth: xero.health,
        closedAt: close.closedAt,
        closedBy: close.closedBy,
        openRequests: close.openRequests,
      };
    })(),
    // Time tracking (timer v2) — OVERVIEW only, and only when the firm's flag
    // is on. Enough rows for a year's stat; the full list lives on the
    // Work → Time timesheet now.
    (async () => {
      if (tab !== "overview") return [];
      const currentFirm = await getCurrentFirm();
      if (!isTimeInsightsEnabled(currentFirm)) return [];
      return listEntriesForClient(id, 1000);
    })(),
    // OVERVIEW ONLY: the Portal access card is the only reader, and this is a
    // service-role query — no reason to run it while someone browses Files.
    // The client's OWN firm, not the viewer's — `firm` is destructured out of
    // this same Promise.all and cannot be read from inside it. Same value
    // either way: RLS already refused to hand us a client from another firm.
    tab === "overview" ? findClientPortalDoor(client.id, client.firm_id) : null,
  ]);

  const [relationships, allClients] = relationshipData;
  const { engagements, signals } = engagementData;
  const { clientPayments, paymentByEng } = moneyData;
  const me = viewer;
  const timeEnabled = isTimeInsightsEnabled(firm);
  // This year's minutes (firm calendar) + value where the viewer's RLS read
  // answers. A staff member's partial rate read is not summed into a fake
  // total: value renders only for insights.view / rates.manage holders.
  const thisYear = todayInTimeZone(firm?.timezone ?? "UTC").slice(0, 4);
  const clientYearEntries = clientTimeEntries.filter(
    (e) =>
      (dateInTimeZone(e.started_at, firm?.timezone ?? "UTC") ?? "").slice(
        0,
        4,
      ) === thisYear,
  );
  const clientTimeMinutesThisYear = clientYearEntries.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
  );
  const canSeeTimeValue = can(me, "insights.view") || can(me, "rates.manage");
  let clientTimeValueCents: number | null = null;
  if (timeEnabled && canSeeTimeValue && clientYearEntries.length > 0) {
    const rates = await listBillableRates(clientYearEntries.map((e) => e.id));
    // NULL when no entry carries a rate — "$0 value" on hours that merely
    // predate the rates is the lie 1780's contract forbids.
    if (rates.size > 0) {
      clientTimeValueCents = clientYearEntries.reduce((sum, e) => {
        const rate = rates.get(e.id);
        return rate == null ? sum : sum + valueCents(e.duration_minutes, rate);
      }, 0);
    }
  }
  const tTime = await getTranslations("Time");
  const clientNameById = new Map(allClients.map((c) => [c.id, c.display_name]));
  const relationshipRows: RelationshipCardRow[] = resolveRelationshipRows(
    client.id,
    relationships,
  )
    // A missing name means RLS hid the other end from this viewer (private
    // client edge); the link row itself is normally hidden with it, so this
    // is belt-and-suspenders rather than an expected path.
    .filter((r) => clientNameById.has(r.otherClientId))
    .map((r) => ({ ...r, otherName: clientNameById.get(r.otherClientId)! }));
  const pickerCandidates = {
    individuals: allClients
      .filter(
        (c) => !c.archived_at && c.type === "individual" && c.id !== client.id,
      )
      .map((c) => ({
        id: c.id,
        display_name: c.display_name,
        type: c.type,
        email: c.email,
      })),
    businesses: allClients
      .filter(
        (c) => !c.archived_at && c.type === "business" && c.id !== client.id,
      )
      .map((c) => ({
        id: c.id,
        display_name: c.display_name,
        type: c.type,
        email: c.email,
      })),
  };

  // Unified status for the pills below — same derivation every other surface
  // reads, via the cached signal load (client-scoped, fetched above).
  const derivedStatusById = new Map(
    signals.map((s) => [
      s.engagement.id,
      deriveEngagementStatus(s.engagement.status, s.attention),
    ]),
  );
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: firmUsers.filter((u) => !u.deactivated_at).length,
  });
  const owner = firmUsers.find((u) => u.id === client.assigned_user_id) ?? null;
  const assignableMembers = firmUsers
    .filter((u) => !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));

  const nameOf = new Map(firmUsers.map((u) => [u.id, userDisplayLabel(u)]));
  const cast = castRows
    // A member whose user row is gone from the roster read has been removed
    // from the firm; showing an id would be worse than showing nothing.
    .filter((m) => nameOf.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: nameOf.get(m.userId)!,
      position: m.position,
    }));
  // Owners see every client, membership or not — so any panel claiming to
  // answer "who can see this" has to include them or it is simply wrong.
  const firmOwners = firmUsers
    .filter((u) => u.role === "owner" && !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));
  const castIds = new Set(cast.map((m) => m.userId));
  const castCandidates = assignableMembers.filter((u) => !castIds.has(u.id));

  // ── Organizers tab: everyone with access, WHY, and their live load ────────
  //
  // One row per person, merged from the three separate ways somebody ends up
  // able to see this client — they own the firm, they're the client's assigned
  // owner, or they were added to its team. Merged rather than listed three
  // times, because the question is "who works on this", and a person who is two
  // of those things is still one person.
  //
  // The live count reads the active worklist — React.cache'd per scope, so on
  // any request that also drew the Engagements tab this is free, and on this
  // tab it is one query rather than one per person.
  const organizerRows = (() => {
    if (!(teamEnabled && tab === "organizers")) return [];
    const liveByUser = new Map<string, number>();
    for (const r of selectForClient(organizerWorklist, id)) {
      if (r.status === "complete" || r.status === "cancelled") continue;
      if (!r.assigneeUserId) continue;
      liveByUser.set(
        r.assigneeUserId,
        (liveByUser.get(r.assigneeUserId) ?? 0) + 1,
      );
    }
    const ownerIds = new Set(firmOwners.map((o) => o.id));
    const byId = new Map<
      string,
      {
        userId: string;
        name: string;
        position: string | null;
        isOwner: boolean;
        isAssignee: boolean;
        isMember: boolean;
        liveCount: number;
      }
    >();
    const put = (userId: string, name: string) => {
      const existing = byId.get(userId);
      if (existing) return existing;
      const row = {
        userId,
        name,
        position: null as string | null,
        isOwner: ownerIds.has(userId),
        isAssignee: client.assigned_user_id === userId,
        isMember: false,
        liveCount: liveByUser.get(userId) ?? 0,
      };
      byId.set(userId, row);
      return row;
    };
    for (const o of firmOwners) put(o.id, o.name);
    if (owner) put(owner.id, userDisplayLabel(owner));
    for (const m of cast) {
      const row = put(m.userId, m.name);
      row.isMember = true;
      // The role somebody was given ON THIS CLIENT ("Preparer", "Reviewer"),
      // which is more specific than their firm-wide job title and is the thing
      // this tab is actually about.
      row.position = m.position ?? row.position;
    }
    // Most loaded first — the point of the column is spotting who is carrying
    // this client. Ties fall back to name so the order is stable between loads.
    return [...byId.values()].sort(
      (a, b) => b.liveCount - a.liveCount || a.name.localeCompare(b.name),
    );
  })();
  // ── The Engagements tab's rows ─────────────────────────────────────────────
  //
  // The SAME worklist every other engagement list in the app is built from,
  // narrowed to this client. Not a second loader and not a second table: the
  // founder's note on the first attempt was that the tab was the overview's
  // little block moved across, and the fix for that is to render the real
  // thing, not to grow the block.
  //
  // Two scopes at most: the active set (which Active / Ready / Completed all
  // slice out of, and which the overview's signals load already warmed — it is
  // React.cache'd per scope) plus, only when you are actually on it, the
  // archived set. Selecting a filter never costs more than one extra query.
  const engagementRows = selectView(
    engView,
    engView === "archived" ? archivedClientRows : activeClientRows,
  );
  // Counts for the filter links. Archived's is deliberately absent unless you
  // are on it — printing a number we did not load would be a guess, and loading
  // it to print would be a query on every other filter (see the component).
  const engagementCounts: Partial<Record<ClientEngagementView, number>> =
    onEngagementsTab
      ? Object.fromEntries(
          CLIENT_ENGAGEMENT_VIEWS.filter(
            (v) => v !== "archived" || engView === "archived",
          ).map((v) => [
            v,
            selectView(
              v,
              v === "archived" ? archivedClientRows : activeClientRows,
            ).length,
          ]),
        )
      : {};

  const t = await getTranslations("Clients");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  // The worklist column labels already exist in Dashboard and read identically
  // here — reusing them keeps one wording for "Assigned to" across the app.
  const tWl = await getTranslations("Dashboard");
  const tStage = await getTranslations("Stage");
  const tHome = await getTranslations("Home");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");
  // The Bookkeeping tab renders the firm-wide bookkeeping components, so it
  // speaks their namespace — reusing their strings rather than a second set of
  // words for "Missing receipts" that could drift from the page they came from.
  const tQb = await getTranslations("Quickbooks");

  // Per-client QuickBooks connection status for the card below. Mirrors how
  // Settings assembles the firm-level status: base status + a health check (which
  // detects a dead/revoked connection) + the platform-configured flag + the OAuth
  // callback result from ?qbo=. Connect/disconnect inside the card are owner-only.
  // BOOKKEEPING TAB ONLY. The health probe in particular is a live call out to
  // the ledger, so every tab switch used to wait on Intuit before painting.
  const { qboStatus, qboHealth, xeroStatus, xeroHealth } = bookkeeping;
  const qboCallbackStatus =
    qboParam === "done" ||
    qboParam === "denied" ||
    qboParam === "error" ||
    qboParam === "setup" ||
    qboParam === "enc" ||
    qboParam === "other"
      ? (qboParam as "done" | "denied" | "error" | "setup" | "enc" | "other")
      : null;
  const clientQuickbooks = {
    configured: isQuickbooksConfigured(),
    connected: Boolean(qboStatus?.connected),
    needsReconnect: qboHealth === "reconnect_required",
    companyName: qboStatus?.companyName ?? null,
    environment: qboStatus?.environment ?? quickbooksEnvironment(),
    callbackStatus: qboCallbackStatus,
  };
  // Per-client Xero status — the sibling of the QuickBooks block above. Health
  // only probes when connected (it doubles as the keep-alive for Xero's 60-day
  // idle expiry).
  const xeroCallbackStatus =
    xeroParam === "done" ||
    xeroParam === "denied" ||
    xeroParam === "error" ||
    xeroParam === "setup" ||
    xeroParam === "inuse" ||
    xeroParam === "other" ||
    xeroParam === "enc"
      ? (xeroParam as
          "done" | "denied" | "error" | "setup" | "inuse" | "other" | "enc")
      : null;
  const clientXero = {
    configured: isXeroConfigured(),
    connected: Boolean(xeroStatus?.connected),
    needsReconnect: xeroHealth === "reconnect_required",
    tenantName: xeroStatus?.tenantName ?? null,
    isDemo: xeroStatus?.isDemo ?? false,
    callbackStatus: xeroCallbackStatus,
  };
  // Is there a set of books to report on at all? Both the close board and the
  // working lists below it are about a LEDGER; with neither provider connected
  // there is nothing to be outstanding, and the connection card is the whole
  // answer the tab has.
  const clientBooksConnected =
    clientQuickbooks.connected || clientXero.connected;
  const isOwner = me?.role === "owner";
  // Connecting this client's books is integrations.manage, NOT the rank. Every
  // connect/disconnect route already checks exactly that capability, so a role
  // granting it worked on the server while this screen still hid the buttons.
  const canConnectBooks = can(me, "integrations.manage");
  // Phase 2: the first two capabilities that actually withhold something. Both
  // are carried by the member preset, so every existing staff member keeps
  // exactly what they have — these only bite once an owner makes someone a
  // Junior.
  const canManageClients = can(me, "clients.manage");
  const canSeeMoney = can(me, "money.view");

  return (
    // Two columns, following Canopy's client profile: a narrow rail of quiet
    // reference cards on the left, and the WORK on the right where the eye
    // lands. The old single 3xl column stacked contact details ABOVE the
    // engagements, so the first thing you saw on a client was their phone
    // number and the actual job list was below the fold.
    //
    // Deliberately not copied from the reference: its ten-tab row, and its
    // Spouse / Dependents / Linked contacts / Tags cards. Vylan has no data
    // behind any of those, and an empty card is worse than no card.
    <div className="w-full space-y-6 px-6 pt-7 pb-18 lg:px-11">
      {/* THE BACK LINK BELONGS TO THE HEADER, so it is grouped with it rather
          than being a sibling in the page's space-y-6 rhythm.

          It used to be a plain sibling, which put 24px between it and the name
          — plus the link's own py-1 — so the identity block sat in about 32px
          of dead air while pressing against the tabs below it. The founder:
          "the client name and profile are drooped down... should be a little
          higher no?" They were reading the gap, and the gap was the bug: 6 is
          the spacing between the page's SECTIONS, and "back" is not a section.
          It is the label on the thing underneath it, so it gets label spacing.

          Grouped this way the rhythm still works — the group as a whole keeps
          its 24px from whatever follows. */}
      <div className="space-y-2">
        {/* One way back, stated plainly. A two-crumb breadcrumb ("Clients /
          Zachary Thresh") spends a line telling you the name you can already
          read at 26px directly underneath it. */}
        <BackLink href="/clients" label={t("back_all_clients")} />

        {/* Canopy puts the identity AND the section tabs in one bordered card at
          the top, so "who am I looking at" and "which part of them" are one
          object. Vylan had a bare header floating above loose sections. */}
        <header>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              {/* The picture if there is one (1530), initials if not — the circle
              was previously always initials, which the founder called "a
              redudant circle". AvatarInitials already handled both; nothing had
              ever given it a src for a CLIENT. */}
              <AvatarInitials
                src={clientAvatarUrl ?? undefined}
                name={client.display_name}
                size={52}
              />
              <div className="min-w-0">
                {/* The client's name IS the menu — the same NameMenu the firm page
              uses, because the founder asked for "the exact same thing". It
              replaces BOTH the pen that used to sit here and the "⋯" that used
              to sit in the corner: two anonymous controls answering one
              question, which is the shape the firm page just shed. */}
                <div className="flex items-center gap-1">
                  <ClientNameMenu
                    client={client}
                    avatarUrl={clientAvatarUrl}
                    locale={locale}
                    canManage={canManageClients}
                    isOwner={isOwner}
                    archiveFormId={CLIENT_ARCHIVE_FORM_ID}
                  />
                </div>
                {/* Just what they ARE. The old row said "Individual · Active · EN"
              on every client on every visit — three chips that are the same for
              almost everyone, which is the noise the kit's "colour marks the
              exception" rule exists to remove. Archived and Private still
              show, because those genuinely are exceptions. */}
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-[13.5px] text-muted-foreground">
                    {client.type === "individual"
                      ? t("type_individual")
                      : t("type_business")}
                  </p>
                  {client.archived_at && (
                    <StatusCapsule tone="muted">{t("archived")}</StatusCapsule>
                  )}
                  {isOwner && client.is_private && (
                    <StatusCapsule tone="warning">
                      <Lock className="size-3" aria-hidden="true" />
                      {t("private_badge")}
                    </StatusCapsule>
                  )}
                  {/* Who owns this client, beside the name — the one thing added to
                the design, because "whose client is this" is the question the
                header is asked most and it was a row further down. */}
                  {teamEnabled && (
                    <ClientAssignee
                      clientId={client.id}
                      assigneeId={client.assigned_user_id}
                      assigneeName={owner ? userDisplayLabel(owner) : null}
                      assigneeDeactivated={!!owner?.deactivated_at}
                      members={assignableMembers}
                    />
                  )}
                </div>
              </div>
            </div>
            {/* ── TIME, AS A BUBBLE IN THE CORNER ───────────────────────────
            Founder: "remove it from that section and just have it sit in a
            bubble on the top right of the screen above the header line."

            It was a Panel in the overview grid, where it never fit: pinned to
            a row no other column used, so it hung below an otherwise square
            page. A client's total time is a FACT ABOUT THE CLIENT, not a
            section of their overview — so it belongs beside their name, not
            in the stack of sections underneath it. Living in the header also
            means it follows you across the tabs, which a panel could not do.

            Hidden at zero rather than reading "no time yet": an empty section
            has to hold its place in a grid, but a bubble that says nothing is
            just something to look at. The Work → Time page is where you go to
            confirm a client has none. */}
            {timeEnabled && clientTimeMinutesThisYear > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3.5 py-1.5">
                <Clock
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="text-[13px] tabular-nums">
                  {tTime("client_stat", {
                    duration: formatMinutes(clientTimeMinutesThisYear),
                  })}
                </span>
                {/* Money only where the billing RLS answered — a viewer
                    without rates sees the hours alone, never a blank. */}
                {clientTimeValueCents != null && (
                  <>
                    <span aria-hidden className="text-border">
                      ·
                    </span>
                    <span className="text-[13px] font-medium tabular-nums">
                      {formatCurrency(clientTimeValueCents / 100, locale, {
                        fractionDigits: 0,
                      })}
                    </span>
                  </>
                )}
                {/* What the two numbers actually mean. Two strings, not one
                    with a conditional clause spliced in: a reader who cannot
                    see money must not be told a dollar figure is there. */}
                <InfoHint
                  text={
                    clientTimeValueCents != null
                      ? tTime("client_stat_hint_value")
                      : tTime("client_stat_hint")
                  }
                  className="-mr-1"
                  iconClassName="size-3.5"
                />
              </div>
            )}

            {/* The corner is now empty of controls — everything moved onto the
            name. The archive form stays here and is reached BY ID from the
            menu, because a <form> cannot be a dropdown item and still submit
            cleanly. */}
            <form
              id={CLIENT_ARCHIVE_FORM_ID}
              action={
                client.archived_at ? restoreClientAction : archiveClientAction
              }
              className="hidden"
            >
              <input type="hidden" name="id" value={client.id} />
            </form>
          </div>

          {/* The tab row, sitting on the card's bottom edge with the active tab
          underlined — Canopy's exact treatment. Rendered by the SHARED
          ProfileTabs: the teammate profile has the identical row, and two
          copies of it is precisely the drift the repo's Cohesion rule names.
          A tab that would open an empty section isn't offered at all (no
          bookkeeping provider configured → no Bookkeeping tab). */}
          <ProfileTabs
            label={client.display_name}
            items={[
              {
                key: "overview",
                href: clientTabHref(client.id, "overview"),
                label: t("tab_overview"),
                active: tab === "overview",
              },
              {
                key: "engagements",
                href: clientTabHref(client.id, "engagements"),
                label: t("engagements"),
                active: tab === "engagements",
              },
              // "Organizers" rather than "Who works on it": the founder asked for
              // the Canopy word, and "team" reads as the firm's own staff list,
              // which is a different page.
              ...(teamEnabled
                ? [
                    {
                      key: "team",
                      href: clientTabHref(client.id, "organizers"),
                      label: t("tab_organizers"),
                      active: tab === "organizers",
                    },
                  ]
                : []),
              ...(clientQuickbooks.configured || clientXero.configured
                ? [
                    {
                      key: "bookkeeping",
                      href: clientTabHref(client.id, "bookkeeping"),
                      label: t("bk_section_title"),
                      active: tab === "bookkeeping",
                    },
                  ]
                : []),
              // Files is still a route of its own, so this tab NAVIGATES away.
              // Files is a real tab now, not a link away: it hosts the same browser
              // /files renders, locked to this client.
              {
                key: "files",
                href: clientTabHref(client.id, "files"),
                label: t("tab_files"),
                active: tab === "files",
              },
            ]}
          />
        </header>
      </div>

      {/* Two columns on the OVERVIEW only. Every other tab is ONE full-width
          column.
          The rail used to be reserved on every tab, so opening Organizers gave
          you a narrow card on the left and a dead gutter filling the other two
          thirds of the screen — the exact "you just moved the little block"
          shape the founder rejected, one level up. A tab whose content is a
          table has no rail to put beside it. */}
      {/* THE OVERVIEW GRID, exactly as designed: two rows, and the cards are
          DIRECT grid children so row 1 (Tasks | Recent files) and row 2
          (Notes | Payments) each stretch to a common height and the column
          bottoms line up. Wrapping them in per-column stacks is what made the
          columns end ragged.

            >=1180  details | tasks  | files      details spans both rows
                            | notes  | payments

          Columns 2 and 3 are both FLUID at 1.35fr / 1fr rather than the
          prototype's fixed 260-340px third track. The prototype was drawn at
          ~1320px, where a capped third column looks right; on a real 1800px+
          monitor that cap freezes Recent files and Payments at 340px while the
          middle column swallows every extra pixel, and they read as offcuts.
          Fluid keeps the intended relationship — middle a little wider, the
          two of them comparable — at every width.
            >= 880  details | tasks / notes / files / payments   (spans 4)
            < 880   one column, in reading order

          Real media queries, not the prototype's JS resize listener — inline
          styles simply cannot carry them. */}
      <div
        className={
          tab === "overview"
            ? "grid gap-5 min-[880px]:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] min-[1180px]:grid-cols-[minmax(240px,300px)_minmax(0,1.35fr)_minmax(0,1fr)]"
            : ""
        }
      >
        {/* ── Left rail (overview only): reference ─────────────────────────
          It used to hold five panels including the two most action-heavy ones
          on the page (connect QuickBooks, set a portal PIN) under a comment
          claiming it was "reference, not action". That is what made the page
          read as a long left column beside an empty right one — founder's
          words. Contact and About merged (both are label/value reference, and
          two boxes of it stacked was arbitrary), and the action panels moved
          across to the work. Sticky, so a long engagements table no longer
          scrolls the rail away into whitespace. */}
        {tab === "overview" && (
          <div className="space-y-5 self-start min-[880px]:row-span-4 min-[1180px]:row-span-2">
            <Panel title={t("details_title")}>
              {/* Read-only by default. Every field renders as a labeled value,
            never an open input box — editing happens deliberately through
            the "Edit client" dialog in the header. This protects the email
            in particular, since it's where document-request links and
            reminders get sent. */}
              {/* One column in the rail — the old two-column grid put a phone
            number beside an email in a space too narrow for either. */}
              <dl className="space-y-3 text-sm">
                <DetailRow label={t("col_email")} value={client.email} />
                <DetailRow label={t("col_phone")} value={client.phone} mono />
                <DetailRow
                  label={t("field_external_ref")}
                  value={client.external_ref}
                  placeholder={t("field_none_yet")}
                  mono
                />
                <li className="!mt-4 border-t border-border/60" aria-hidden />
                <DetailRow
                  label={t("field_type")}
                  value={
                    client.type === "individual"
                      ? t("type_individual")
                      : t("type_business")
                  }
                />
                <DetailRow
                  label={t("field_industry")}
                  value={fieldLabel(INDUSTRIES, client.industry, locale)}
                  placeholder={t("field_none_yet")}
                />
                <DetailRow
                  label={t("field_province")}
                  value={fieldLabel(PROVINCES, client.province, locale)}
                  placeholder={t("field_none_yet")}
                />
                <DetailRow
                  label={t("field_locale")}
                  value={client.locale === "fr" ? "Français" : "English"}
                />
                <DetailRow
                  label={t("client_since")}
                  value={formatDate(client.created_at, locale, "medium")}
                />
                {/* The old single notes FIELD is gone from here. Authored notes
              (1270) live in their own panel with an author and a date, and
              the same page showing both meant "Notes —" beside a box that
              already had notes in it. */}
              </dl>
            </Panel>

            {/* Relationships — the entity tree (spec §2). Between About and
          Bookkeeping, always rendered (the empty state keeps the feature
          discoverable). Renders its own Panel-identical section because the
          [+], kebabs and View-all need client state.
          No tab check of its own: the whole rail is already overview-only. */}
            <RelationshipsCard
              clientId={client.id}
              clientType={client.type}
              rows={relationshipRows}
              candidates={pickerCandidates}
              canManage={canManageClients && !client.archived_at}
            />

            {/* Portal access — the optional code that gates this client's portal
          link. Left column with the other reference cards, and compact: it is
          one switch and a link, not a section. The code itself is deliberately
          NOT passed in — the card fetches it through an audit-logged action, so
          it never sits in this page's HTML. */}
            <Panel title={t("portal_access_title")}>
              <ClientPortalPinCard
                clientId={client.id}
                initialEnabled={client.portal_pin_enabled === true}
              />
              {/* ── THE DOOR, WHERE THE LOCK ALREADY IS ────────────────────
                  Founder asked for the portal to be openable from the client's
                  page, in this section. It belongs beside the access code for
                  the obvious reason: this card is already the answer to "how
                  does this client get in", and the code and the link are two
                  halves of that one question.

                  It appears only when there IS a portal — that is not a
                  setting but a consequence of having a live sent engagement
                  (see findClientPortalDoor). No portal, no link: a "View
                  portal" button that opens nothing is precisely the dead
                  control the founder has asked twice not to ship.

                  When the access code is on, the firm meets the same gate the
                  client does — so the warning says so rather than letting a
                  code prompt look like a bug. */}
              {portalDoor && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <PortalDoorLink
                    token={portalDoor.token}
                    label={t("portal_open")}
                    warning={
                      client.portal_pin_enabled === true
                        ? t("portal_open_warning_pin")
                        : t("portal_open_warning")
                    }
                  />
                </div>
              )}
            </Panel>

            {/* Portal access — the optional 6-digit code that gates this client's
          portal link. Off for everyone by default; the frictionless link stays
          the product's default story. Owners and staff both manage it, in line
          with the rest of this profile.
          The code itself is deliberately NOT passed in: the card fetches it
          through an audit-logged action, so it never sits in this page's
          HTML. */}
          </div>
        )}

        {/* TASKS — a VIEW of the one task list (see the Tasks rule in
          CLAUDE.md), not a second store. Whatever is created on an engagement
          for this client, or straight on the client, shows up here the moment
          it exists; this page owns none of it.

          Status sits in a FIXED left column so the titles line up down the
          card — Canopy's treatment, and the reason a mixed-status list stays
          scannable instead of zig-zagging. */}
        {tab === "overview" && (
          <Panel
            className="min-h-[190px] min-[880px]:col-start-2 min-[880px]:row-start-1"
            title={t("tasks_title")}
            action={
              <Link
                href="/work"
                className="text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
              >
                {t("tasks_view_all")}
              </Link>
            }
          >
            {clientTasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("tasks_empty")}
              </p>
            ) : (
              <ul className="divide-y divide-border/45">
                {clientTasks.slice(0, 6).map((task) => (
                  <li key={task.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-[138px] shrink-0">
                      <StatusCapsule
                        tone={
                          task.status === "done"
                            ? "success"
                            : task.status === "doing"
                              ? "accent"
                              : "muted"
                        }
                      >
                        {t(`task_status_${task.status}`)}
                      </StatusCapsule>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-[12.5px] text-muted-foreground">
                      {task.dueDate
                        ? formatDate(task.dueDate, locale, "compact")
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tab === "overview" && (
          <Panel
            className="min-h-[240px] min-[880px]:col-start-2 min-[880px]:row-start-2"
            title={t("notes_title")}
          >
            <ClientNotes
              clientId={client.id}
              notes={clientNotes}
              viewerId={me?.id ?? null}
              locale={locale}
            />
          </Panel>
        )}

        {/* Renders EMPTY rather than disappearing. A panel that vanishes when it
          has nothing in it makes the overview reflow into a different shape per
          client, so you cannot learn where anything lives — and it hides the
          "View all" link exactly when a new client most needs somewhere to put
          a first file. Same reasoning as Tasks and Notes above. */}
        {tab === "overview" && (
          <Panel
            className="min-h-[190px] min-[880px]:col-start-2 min-[880px]:row-start-3 min-[1180px]:col-start-3 min-[1180px]:row-start-1"
            title={t("recent_files")}
            action={
              <Link
                href={`/clients/${client.id}/archive`}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("view_all_files")}
              </Link>
            }
          >
            {recentFiles.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("recent_files_empty")}
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {recentFiles.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 py-2.5">
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{file.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(file.createdAt, locale, "medium")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* canSeeMoney stays — that is a PERMISSION, not an emptiness check, and
          someone who may not see money must still not see this panel at all.
          Only the "has rows" half is dropped, for the reason above. */}
        {tab === "overview" && canSeeMoney && (
          <Panel
            className="min-h-[190px] min-[880px]:col-start-2 min-[880px]:row-start-4 min-[1180px]:col-start-3 min-[1180px]:row-start-2"
            title={tEng("payments_history")}
            flush={clientPayments.length > 0}
          >
            {clientPayments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {tEng("payments_history_empty")}
              </p>
            ) : (
              <PaymentsList
                rows={clientPayments}
                showClient={false}
                currentUserId={me?.id}
              />
            )}
          </Panel>
        )}

        {/* ── The other tabs render one full-width column ───────────────── */}
        {tab !== "overview" && (
          <div className="space-y-6">
            {/* ── ORGANIZERS TAB: who works on this client ──────────────────────
          Two panels, full width. "Who can see this" is the control (add
          someone, give them a role); the table beside it is the ANSWER — every
          person with access, why they have it, and how much of this client's
          live work is actually on them. The tab used to be the access card
          alone, floating in a rail with two thirds of the screen empty. */}
            {teamEnabled && tab === "organizers" && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <Panel title={t("access_title")}>
                  <ClientAccess
                    clientId={id}
                    members={cast}
                    owners={firmOwners}
                    assignee={
                      owner
                        ? { id: owner.id, name: userDisplayLabel(owner) }
                        : null
                    }
                    candidates={castCandidates}
                    canEdit={canManageClients}
                  />
                </Panel>

                <Panel title={t("organizers_workload_title")} flush>
                  {organizerRows.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      {t("organizers_workload_empty")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/60 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                            <th className="px-4 py-2 font-medium">
                              {t("organizers_col_person")}
                            </th>
                            <th className="px-4 py-2 font-medium">
                              {t("organizers_col_why")}
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              {t("organizers_col_live")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {organizerRows.map((r) => (
                            <tr
                              key={r.userId}
                              className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40"
                            >
                              <td className="px-4 py-3 align-middle">
                                <Link
                                  href={`/settings/team/${r.userId}`}
                                  className="flex items-center gap-2.5 font-medium hover:underline"
                                >
                                  <AvatarInitials name={r.name} size={26} />
                                  <span className="truncate">{r.name}</span>
                                </Link>
                                {r.position && (
                                  <span className="ml-[2.3rem] block text-xs text-muted-foreground">
                                    {r.position}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 align-middle">
                                {/* WHY they can see this client, not just that they
                              can. An owner sees every client whether or not
                              anyone added them, and a panel that doesn't say so
                              is simply wrong about who is looking. */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {r.isOwner && (
                                    <Badge
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      {t("organizers_why_owner")}
                                    </Badge>
                                  )}
                                  {r.isAssignee && (
                                    <Badge
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      {t("organizers_why_assignee")}
                                    </Badge>
                                  )}
                                  {r.isMember && (
                                    <Badge
                                      variant="outline"
                                      className="font-normal"
                                    >
                                      {t("organizers_why_member")}
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right align-middle tabular-nums">
                                {r.liveCount > 0 ? (
                                  r.liveCount
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* Canopy's "Active Tasks (4)" panel: a titled box whose body is a real
          TABLE with column headers, not a bare list of links. The columns are
          the questions you actually ask of a client's work — where is it, what
          is it, who has it, when is it due — and the status reads as a coloured
          dot plus a word, which is Canopy's treatment and quieter than a row of
          filled pills. */}
            {/* ── FILES TAB: the firm's file browser, locked to this client ──────
          Literally the component /files renders — path bar, folder rows, drag
          to move, bulk bar, upload, sort, the lot — with `lockedClientId` set
          so you start inside this client's folders and no link can wander out
          to another client's.
          Founder: "for the files it should be the full archive browser — like
          you're just porting it to the client's page", and "get rid of file
          archive; it exists purely within the files on a client's page". So
          /clients/[id]/archive is now a redirect that lands here.
          No Panel around it: the browser draws its own toolbar and path bar,
          and a titled box around a file manager is a second frame. */}
            {tab === "files" && (
              <div className="space-y-4">
                {/* Download-everything moved INTO the browser's own toolbar
                    (BrowseTab -> PathBar trailing): it used to sit here on its
                    own right-aligned line above the header, which is the
                    "weird spot" the founder called out. */}
                <BrowseTab
                  locale={locale}
                  sp={sp}
                  basePath={`/clients/${client.id}`}
                  // Rides on every link the browser writes, so a folder click stays
                  // on this tab instead of dropping back to the overview.
                  baseParams={{ tab: "files" }}
                  lockedClientId={client.id}
                />
              </div>
            )}

            {/* The ENGAGEMENTS TAB — the real list, not this preview. Same table the
          /engagements section renders (progress, attention, presence, the row
          menu), narrowed to this client, with the lifecycle filter and a search
          box of its own. */}
            {tab === "engagements" && (
              <Panel
                title={t("engagements")}
                aside={
                  <FilterLinks
                    label={t("engagements")}
                    items={CLIENT_ENGAGEMENT_VIEWS.map((v) => ({
                      key: v,
                      href: clientEngagementViewHref(client.id, v),
                      label: tEng(
                        viewLabelKey(v) as Parameters<typeof tEng>[0],
                      ),
                      active: v === engView,
                      count: engagementCounts[v],
                    }))}
                  />
                }
                action={
                  !client.archived_at ? (
                    <Link href={`/engagements/new?client=${client.id}`}>
                      <Button size="sm">
                        <Plus className="size-4" />
                        {tEng("new")}
                      </Button>
                    </Link>
                  ) : null
                }
                flush
              >
                <WorklistBrowser
                  rows={engagementRows}
                  locale={locale}
                  emptyText={tEng(`view_${engView}_empty`)}
                  emptySearchText={tWl("wl_empty_search")}
                  emptyStageText={tStage("empty_for_stage")}
                  canDelete={canManageClients}
                  teamEnabled={teamEnabled}
                  assignMembers={assignableMembers}
                  viewerId={me?.id ?? null}
                  firmId={firm?.id ?? null}
                />
              </Panel>
            )}

            {/* Moved out of the rail. Connecting a client's books and setting
            their portal PIN are ACTIONS on the client, and the rail is
            reference — the comment above it said so while these two sat in
            it. They also give the work column something to hold on a client
            with few engagements, which is what left the right side empty. */}
            {/* ── THE WORK, above the plumbing ───────────────────────────────
            The tab used to be the connection card and nothing else, which
            answered "are this client's books hooked up" — a question you ask
            once — and never "what is outstanding for them", which is the one
            you ask every month. The close board and the two working lists now
            lead; the connection cards sit underneath as reference.

            Every piece here is the SAME component the firm-wide Bookkeeping
            page renders, given one client instead of all of them. */}
            {tab === "bookkeeping" && clientBooksConnected && (
              <Panel title={tQb("close_title")}>
                <CloseBoard
                  scope="client"
                  period={period}
                  locale={locale}
                  rows={[
                    {
                      clientId: client.id,
                      name: client.display_name,
                      provider: clientQuickbooks.connected
                        ? "quickbooks"
                        : "xero",
                      openRequests: bookkeeping.openRequests,
                      closedAt: bookkeeping.closedAt,
                      closedBy: bookkeeping.closedBy
                        ? (nameOf.get(bookkeeping.closedBy) ?? null)
                        : null,
                    },
                  ]}
                />
              </Panel>
            )}

            {/* The two working lists, as tabs of one panel — the shape the
            firm-wide page uses, for the reason it uses it: each is a LIVE read
            of this client's ledger, so only the one you are looking at runs.
            QuickBooks only. A Xero client gets the same honest note the close
            board's own books column gives them rather than an empty list,
            which would read as "nothing outstanding". */}
            {tab === "bookkeeping" && clientBooksConnected && (
              <Panel
                title={tQb("bk_logs_title")}
                aside={
                  clientQuickbooks.connected ? (
                    <FilterLinks
                      label={tQb("bk_logs_title")}
                      items={CLIENT_BOOKKEEPING_VIEWS.map((v) => ({
                        key: v,
                        href: clientBookkeepingViewHref(client.id, v, period),
                        label:
                          v === "receipts"
                            ? tQb("gaps_title")
                            : tQb("uncat_title"),
                        active: v === bkView,
                      }))}
                    />
                  ) : undefined
                }
              >
                {!clientQuickbooks.connected ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tQb("close_ledger_xero_pending")}
                  </p>
                ) : bkView === "uncategorized" ? (
                  <UncategorizedTab sp={sp} lockedClientId={client.id} />
                ) : (
                  <ReceiptsTab
                    locale={locale}
                    sp={sp}
                    lockedClientId={client.id}
                  />
                )}
              </Panel>
            )}

            {/* Bookkeeping lives on the client's own page: an OWNER can connect
            this client here (the client is known from context — no
            name-matching), and once connected everyone sees the status. ONE
            system per client: once QuickBooks is connected the Xero card hides
            (and vice versa) — a receipt can only belong in one set of books.
            Hidden entirely for staff on a not-yet-connected client. */}
            {tab === "bookkeeping" &&
              (clientQuickbooks.connected ||
                clientXero.connected ||
                (canConnectBooks &&
                  (clientQuickbooks.configured || clientXero.configured))) && (
                <Panel title={t("bk_section_title")}>
                  {(clientQuickbooks.connected ||
                    (canConnectBooks &&
                      clientQuickbooks.configured &&
                      !clientXero.connected)) && (
                    <ClientQuickbooksCard
                      clientId={client.id}
                      clientName={client.display_name}
                      status={clientQuickbooks}
                      canManage={canConnectBooks}
                    />
                  )}
                  {(clientXero.connected ||
                    (canConnectBooks &&
                      clientXero.configured &&
                      !clientQuickbooks.connected)) && (
                    <ClientXeroCard
                      clientId={client.id}
                      clientName={client.display_name}
                      status={clientXero}
                      canManage={canConnectBooks}
                    />
                  )}
                </Panel>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

// A titled box. Canopy's whole page is these — every section, however small,
// is its own bordered card with a header band, which is what makes a dense
// profile scannable instead of a wall. `flush` drops the body padding for
// panels whose content is a table that should meet the edges.

function DetailRow({
  label,
  value,
  mono = false,
  wide = false,
  placeholder,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  wide?: boolean;
  /** What an empty field SAYS. A bare "—" makes the reader work out whether
   * the value is missing, unknown, or not applicable; "None yet" answers it. */
  placeholder?: string;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (value ? "" : "text-muted-foreground/60") +
          " mt-0.5 whitespace-pre-wrap"
        }
      >
        {value ?? placeholder ?? "—"}
      </dd>
    </div>
  );
}
