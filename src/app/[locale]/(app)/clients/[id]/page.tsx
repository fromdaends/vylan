import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getClient, listClients } from "@/lib/db/clients";
import { listRelationshipsForClient } from "@/lib/db/relationships";
import { resolveRelationshipRows } from "@/lib/relationships/validate";
import {
  RelationshipsCard,
  type RelationshipCardRow,
} from "@/components/clients/relationships-card";
import { listEngagements } from "@/lib/db/engagements";
import { loadEngagementSignals } from "@/lib/dashboard/worklist";
import { deriveEngagementStatus } from "@/lib/attention";
import {
} from "@/lib/engagements/status-pill";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { listClientMembers } from "@/lib/db/client-members";
import { ClientAccess } from "@/components/clients/client-access";
// PLAIN module, not a "use client" one: this Server Component CALLS these, and
// a client-module export would be a client reference that throws (#959).
import { parseClientTab, clientTabHref } from "@/lib/clients/tabs";
import { listDocuments } from "@/lib/db/documents";
import { hasActiveTeam } from "@/lib/team/mode";
import { ClientAssignee } from "@/components/clients/client-assignee";
import { ClientActionsMenu } from "@/components/clients/client-actions-menu";
import {
  getLatestPaymentStatusByEngagementIds,
  listFirmPaymentsWithNames,
} from "@/lib/db/payment-requests";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/payments/payment-badge";
import { RecurringBadge } from "@/components/engagements/recurring-badge";
import { PaymentsList } from "@/components/payments/payments-list";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { Plus, FileText, Lock } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/cn";
import { STAGE_BG_CLASS } from "@/lib/engagements/stage";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { can } from "@/lib/auth/capabilities";
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

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ qbo?: string; xero?: string; tab?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const {
    qbo: qboParam,
    xero: xeroParam,
    tab: tabParam,
  } = await searchParams;
  // Which facet of this client we are looking at. The tab is a URL rather than
  // client state, so a tab is linkable, opens in a new tab, and the back
  // button works — and each tab's data loads only when that tab is asked for.
  const tab = parseClientTab(tabParam);
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const client = await getClient(id);
  if (!client) notFound();

  // Relationships card data: this client's live links, plus the firm roster of
  // clients — archived included so a link's NAME still resolves even when its
  // other end is archived (the picker below re-filters to live clients only).
  const [relationships, allClients] = await Promise.all([
    listRelationshipsForClient(client.id),
    listClients({ includeArchived: true }),
  ]);
  const clientNameById = new Map(
    allClients.map((c) => [c.id, c.display_name]),
  );
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

  const engagements = await listEngagements({ client_id: id });
  // Unified status for the pills below — same derivation every other surface
  // reads, via the cached active-scope signal load.
  const signals = await loadEngagementSignals("active");
  const derivedStatusById = new Map(
    signals.map((s) => [
      s.engagement.id,
      deriveEngagementStatus(s.engagement.status, s.attention),
    ]),
  );
  // Self-heal: re-check this client's still-"requested" payments against Stripe
  // (webhook-independent) so Paid shows even if the webhook never delivered, then
  // read the now-correct statuses for display. Bounded to one client's payments.
  const firm = await getCurrentFirm();
  // Team roster for the owner picker. Include deactivated members so a
  // former owner's name still renders (with a "please reassign" nudge);
  // only ACTIVE members are valid reassignment targets.
  const [firmUsers, me] = await Promise.all([
    listFirmUsers(),
    getCurrentUser(),
  ]);
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: firmUsers.filter((u) => !u.deactivated_at).length,
  });
  const owner =
    firmUsers.find((u) => u.id === client.assigned_user_id) ?? null;
  const assignableMembers = firmUsers
    .filter((u) => !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));

  // Phase 3 slice 1: who works on this client. Descriptive only — nothing
  // reads it for access control yet (see 1210_client_members.sql).
  const castRows = await listClientMembers(id);
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
  const connectedAccountId = firm?.stripe_connect_account_id ?? null;
  if (connectedAccountId) {
    const pending = await listFirmPaymentsWithNames({ clientId: id });
    await Promise.all(
      pending
        .filter((p) => p.status === "requested")
        .map((p) => reconcilePaymentRequest(p.id, connectedAccountId)),
    );
  }
  // Payment status per engagement (for the chip) + this client's payment history
  // (so the accountant can backtrack what was paid on which engagement).
  const [paymentByEng, clientPayments] = await Promise.all([
    getLatestPaymentStatusByEngagementIds(engagements.map((e) => e.id)),
    listFirmPaymentsWithNames({ clientId: id }),
  ]);

  // The overview's "Recent files" card. Only fetched for the overview — every
  // other tab would pay for a query it never renders, which is the point of
  // putting the tab in the URL. Fails soft: the Files view is gated on its own
  // migration, and a client profile must not 500 because that is unapplied.
  const recentFiles =
    tab === "overview"
      ? await listDocuments({ clientId: id, sort: "date", page: 1 })
          .then((page) => page.documents.slice(0, 5))
          .catch(() => [])
      : [];
  const t = await getTranslations("Clients");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  // The worklist column labels already exist in Dashboard and read identically
  // here — reusing them keeps one wording for "Assigned to" across the app.
  const tWl = await getTranslations("Dashboard");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  // Per-client QuickBooks connection status for the card below. Mirrors how
  // Settings assembles the firm-level status: base status + a health check (which
  // detects a dead/revoked connection) + the platform-configured flag + the OAuth
  // callback result from ?qbo=. Connect/disconnect inside the card are owner-only.
  const qboStatus = await getClientQuickbooksStatus(client.id);
  const qboHealth =
    firm && qboStatus?.connected
      ? await getQuickbooksConnectionHealth(firm.id, client.id)
      : "ok";
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
  const xeroStatus = await getClientXeroStatus(client.id);
  const xeroHealth =
    firm && xeroStatus?.connected
      ? await getXeroConnectionHealth(firm.id, client.id)
      : "ok";
  const xeroCallbackStatus =
    xeroParam === "done" ||
    xeroParam === "denied" ||
    xeroParam === "error" ||
    xeroParam === "setup" ||
    xeroParam === "inuse" ||
    xeroParam === "other" ||
    xeroParam === "enc"
      ? (xeroParam as
          | "done"
          | "denied"
          | "error"
          | "setup"
          | "inuse"
          | "other"
          | "enc")
      : null;
  const clientXero = {
    configured: isXeroConfigured(),
    connected: Boolean(xeroStatus?.connected),
    needsReconnect: xeroHealth === "reconnect_required",
    tenantName: xeroStatus?.tenantName ?? null,
    isDemo: xeroStatus?.isDemo ?? false,
    callbackStatus: xeroCallbackStatus,
  };
  const isOwner = me?.role === "owner";
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
    <div className="space-y-6 max-w-6xl">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          { label: client.display_name },
        ]}
      />

      {/* Canopy puts the identity AND the section tabs in one bordered card at
          the top, so "who am I looking at" and "which part of them" are one
          object. Vylan had a bare header floating above loose sections. */}
      <header className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <AvatarInitials name={client.display_name} size={44} />
          <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.display_name}
          </h1>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Badge variant="secondary">
              {client.type === "individual"
                ? t("type_individual")
                : t("type_business")}
            </Badge>
            {client.archived_at ? (
              <Badge variant="outline">{t("archived")}</Badge>
            ) : (
              <Badge>{t("active")}</Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs">
              {client.locale.toUpperCase()}
            </span>
            {isOwner && client.is_private && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
              >
                <Lock className="size-3" aria-hidden="true" />
                {t("private_badge")}
              </Badge>
            )}
          </div>
          {teamEnabled && (
            <div className="mt-3">
              <ClientAssignee
                clientId={client.id}
                assigneeId={client.assigned_user_id}
                assigneeName={owner ? userDisplayLabel(owner) : null}
                assigneeDeactivated={!!owner?.deactivated_at}
                members={assignableMembers}
              />
            </div>
          )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/clients/${client.id}/archive`}>
            <Button variant="outline" size="sm">
              <FileText className="size-4" />
              {t("document_archive")}
            </Button>
          </Link>
          {canManageClients && (
            <ClientFormDialog mode="edit" locale={locale} client={client} />
          )}
          {client.archived_at ? (
            <form action={restoreClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("restore")}
              </Button>
            </form>
          ) : (
            <form action={archiveClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("archive")}
              </Button>
            </form>
          )}
          {isOwner && teamEnabled && (
            <ClientActionsMenu
              clientId={client.id}
              isPrivate={client.is_private ?? false}
            />
          )}
        </div>
      </div>

      {/* The tab row, sitting on the card's bottom edge with the active tab
          underlined — Canopy's exact treatment. TWO tabs, not their ten: these
          are the only two places a client's own content actually lives in
          Vylan, and a tab that opens an empty section is the bloat the founder
          asked to leave out. They NAVIGATE (Documents is its own route) rather
          than toggling a client-side panel, so a link still opens in a new tab
          and the back button still works. */}
      <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          { key: "overview", href: clientTabHref(client.id, "overview"), label: t("tab_overview"), active: tab === "overview" },
          { key: "engagements", href: clientTabHref(client.id, "engagements"), label: t("engagements"), active: tab === "engagements" },
          // "Team" rather than "Who works on it": on a client, the firm's own
          // people ARE the team on that client, and the shorter noun is what
          // Canopy's tab row is made of.
          ...(teamEnabled
            ? [{ key: "team", href: clientTabHref(client.id, "team"), label: t("tab_team"), active: tab === "team" }]
            : []),
          ...(clientQuickbooks.configured || clientXero.configured
            ? [{ key: "bookkeeping", href: clientTabHref(client.id, "bookkeeping"), label: t("bk_section_title"), active: tab === "bookkeeping" }]
            : []),
          // Files is a real route of its own, so this tab NAVIGATES rather than
          // switching a panel — a link that still opens in a new tab.
          { key: "documents", href: `/clients/${client.id}/archive`, label: t("tab_files"), active: false },
        ].map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={
              item.active
                ? "-mb-px whitespace-nowrap border-b-2 border-foreground px-3 py-2.5 text-sm font-medium text-foreground"
                : "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">
      {/* ── Left rail: reference, and who can see this ───────────────────
          It used to hold five panels including the two most action-heavy ones
          on the page (connect QuickBooks, set a portal PIN) under a comment
          claiming it was "reference, not action". That is what made the page
          read as a long left column beside an empty right one — founder's
          words. Contact and About merged (both are label/value reference, and
          two boxes of it stacked was arbitrary), and the action panels moved
          across to the work. Sticky, so a long engagements table no longer
          scrolls the rail away into whitespace. */}
      <div className="space-y-4 lg:sticky lg:top-6">
      {/* Who can see this client — the whole Team tab. It used to sit first in
          the rail on every view; as its own tab it stops competing with the
          work for the top of the page, and gets room to breathe when you do
          want it. */}
      {teamEnabled && tab === "team" && (
        <Panel title={t("access_title")}>
          <ClientAccess
            clientId={id}
            isPrivate={client.is_private ?? false}
            members={cast}
            owners={firmOwners}
            assignee={owner ? { id: owner.id, name: userDisplayLabel(owner) } : null}
            firmSize={assignableMembers.length}
            candidates={castCandidates}
            canEdit={canManageClients}
          />
        </Panel>
      )}

      {tab === "overview" && (
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
            value={client.industry ?? null}
          />
          <DetailRow
            label={t("field_province")}
            value={client.province ?? null}
          />
          <DetailRow
            label={t("field_locale")}
            value={client.locale === "fr" ? "Français" : "English"}
          />
          <DetailRow
            label={t("client_since")}
            value={formatDate(client.created_at, locale, "medium")}
          />
          <DetailRow label={t("field_notes")} value={client.notes} wide />
        </dl>
      </Panel>
      )}

      {/* Relationships — the entity tree (spec §2). Between About and
          Bookkeeping, always rendered (the empty state keeps the feature
          discoverable). Renders its own Panel-identical section because the
          [+], kebabs and View-all need client state. */}
      {tab === "overview" && (
        <RelationshipsCard
          clientId={client.id}
          clientType={client.type}
          rows={relationshipRows}
          candidates={pickerCandidates}
          canManage={canManageClients && !client.archived_at}
        />
      )}

      {/* Portal access — the optional 6-digit code that gates this client's
          portal link. Off for everyone by default; the frictionless link stays
          the product's default story. Owners and staff both manage it, in line
          with the rest of this profile.
          The code itself is deliberately NOT passed in: the card fetches it
          through an audit-logged action, so it never sits in this page's
          HTML. */}


      </div>

      {/* ── Main column: the work ────────────────────────────────────────── */}
      <div className="space-y-6">
      {/* Canopy's "Active Tasks (4)" panel: a titled box whose body is a real
          TABLE with column headers, not a bare list of links. The columns are
          the questions you actually ask of a client's work — where is it, what
          is it, who has it, when is it due — and the status reads as a coloured
          dot plus a word, which is Canopy's treatment and quieter than a row of
          filled pills. */}
      {(tab === "overview" || tab === "engagements") && (
      <Panel
        title={`${t("engagements")} (${engagements.length})`}
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
        {engagements.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("engagements_empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{tWl("wl_col_status")}</th>
                  <th className="px-4 py-2 font-medium">{t("engagements")}</th>
                  {teamEnabled && (
                    <th className="hidden px-4 py-2 font-medium lg:table-cell">
                      {tWl("wl_col_assigned")}
                    </th>
                  )}
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">
                    {tWl("wl_col_due")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((e) => {
                  const derived = derivedStatusById.get(e.id) ?? e.status;
                  const pay = paymentByEng.get(e.id);
                  const holder = firmUsers.find(
                    (u) => u.id === e.assigned_user_id,
                  );
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 align-middle">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span
                            aria-hidden
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              e.stage
                                ? STAGE_BG_CLASS[e.stage]
                                : "bg-muted-foreground",
                            )}
                          />
                          <span className="text-muted-foreground">
                            {tStatus(derived)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <Link
                          href={`/engagements/${e.id}`}
                          className="font-medium hover:underline"
                        >
                          {e.title}
                        </Link>
                        <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
                          {e.series_id && (
                            <RecurringBadge label={tEng("repeat_badge")} compact />
                          )}
                          {pay && pay.status !== "canceled" && (
                            <PaymentBadge status={pay.status} />
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {e.type.toUpperCase()}
                        </span>
                      </td>
                      {teamEnabled && (
                        <td className="hidden px-4 py-3 align-middle text-muted-foreground lg:table-cell">
                          {holder ? userDisplayLabel(holder) : "—"}
                        </td>
                      )}
                      <td className="hidden whitespace-nowrap px-4 py-3 align-middle text-muted-foreground sm:table-cell">
                        {e.due_date
                          ? formatDate(e.due_date, locale, "medium")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      )}

        {/* Moved out of the rail. Connecting a client's books and setting
            their portal PIN are ACTIONS on the client, and the rail is
            reference — the comment above it said so while these two sat in
            it. They also give the work column something to hold on a client
            with few engagements, which is what left the right side empty. */}
        {/* Bookkeeping lives on the client's own page: an OWNER can connect this
            client here (the client is known from context — no name-matching), and
            once connected everyone sees the status. ONE system per client: once
            QuickBooks is connected the Xero card hides (and vice versa) — a
            receipt can only belong in one set of books. Hidden entirely for
            staff on a not-yet-connected client. */}
        {tab === "bookkeeping" &&
          (clientQuickbooks.connected ||
          clientXero.connected ||
          (isOwner && (clientQuickbooks.configured || clientXero.configured))) && (
          <Panel title={t("bk_section_title")}>
            {(clientQuickbooks.connected ||
              (isOwner &&
                clientQuickbooks.configured &&
                !clientXero.connected)) && (
                <ClientQuickbooksCard
                  clientId={client.id}
                  clientName={client.display_name}
                  status={clientQuickbooks}
                  isOwner={isOwner}
                />
              )}
            {(clientXero.connected ||
              (isOwner &&
                clientXero.configured &&
                !clientQuickbooks.connected)) && (
                <ClientXeroCard
                  clientId={client.id}
                  clientName={client.display_name}
                  status={clientXero}
                  isOwner={isOwner}
                />
              )}
          </Panel>
        )}

        {tab === "overview" && (
        <Panel title={t("portal_access_title")}>
          <ClientPortalPinCard
            clientId={client.id}
            initialEnabled={client.portal_pin_enabled === true}
          />
        </Panel>
        )}

      {/* Recent files — Canopy's overview card: the last handful, newest
          first, with a quiet "View all" to the full archive. The overview
          should answer "what has been coming in from this client lately"
          without making you leave it. */}
      {tab === "overview" && recentFiles.length > 0 && (
        <Panel
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
        </Panel>
      )}

      {/* Money. A Junior sees the WORK on a client and not what it was billed
          for — the payments history is amounts, dates and status, which is
          exactly the thing money.view withholds. */}
      {tab === "overview" && canSeeMoney && clientPayments.length > 0 && (
        <Panel title={tEng("payments_history")} flush>
          <PaymentsList
            rows={clientPayments}
            showClient={false}
            currentUserId={me?.id}
          />
        </Panel>
      )}
      </div>
      </div>
    </div>
  );
}

// A titled box. Canopy's whole page is these — every section, however small,
// is its own bordered card with a header band, which is what makes a dense
// profile scannable instead of a wall. `flush` drops the body padding for
// panels whose content is a table that should meet the edges.
function Panel({
  title,
  action,
  flush = false,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  wide?: boolean;
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
        {value ?? "—"}
      </dd>
    </div>
  );
}

