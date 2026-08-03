import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { selectAssignedTo } from "@/lib/dashboard/worklist-select";
import { scopeForView, selectView, viewLabelKey } from "@/lib/engagements/views";
import { listClients } from "@/lib/db/clients";
import { countLiveSeriesByAssignee } from "@/lib/db/recurring";
import { filterClientsByOwner } from "@/components/clients/owner";
import { listClientIdsForMember } from "@/lib/db/client-members";
import { listActivityForFirm } from "@/lib/db/activity";
import {
  AUDIT_ACTIONS,
} from "@/components/settings/audit-actions";
import { getBrandingImageUrl } from "@/lib/storage";
import { WorklistTable } from "@/components/dashboard/engagements-worklist";
import { WorklistBrowser } from "@/components/dashboard/worklist-browser";
import { ClientsTable } from "@/components/clients/clients-table";
import type { ClientOwner } from "@/components/clients/owner";
import { buildClientEngagementIndex } from "@/lib/clients/engagement-index";
import { listEngagements } from "@/lib/db/engagements";
import { ProfileTabs } from "@/components/ui/profile-tabs";
import { FilterLinks } from "@/components/ui/filter-links";
// PLAIN module, not a "use client" one: this Server Component CALLS these, and
// a client-module export would be a client reference that throws (#959).
import {
  parseTeamProfileTab,
  teamProfileTabHref,
} from "@/lib/team/profile-tabs";
import { HandOverWork } from "@/components/settings/team/hand-over-work";
import { DeactivateMember } from "@/components/settings/team/deactivate-member";
import { MemberPermissions } from "@/components/settings/team/member-permissions";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Panel } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { listFirmRoles, listRoleIdsForUser } from "@/lib/db/firm-roles";
import { MemberRoles } from "@/components/settings/team/member-roles";
import { RoleBadges } from "@/components/settings/team/role-badge";

export const dynamic = "force-dynamic";

// A teammate's profile — "everything they're doing" in one place, and now the
// ONLY place. This page used to end each section with a "view all" link into
// /engagements?assignee=<id> and /clients?owner=<id>: the shared lists, wearing
// a filter. Those pages kept their own title and never named whose work you were
// looking at — and clicking any lifecycle tab there silently dropped the person,
// because Active/Ready/Completed are separate ROUTES that don't carry the
// param. Verified in production: land on a teammate's lens, click "Completed",
// and you are looking at YOUR completed work with the picker flipped back to
// "My engagements" and nothing saying so. Worse, the link led to the same rows
// this page already shows. Pure loss, so it's gone — and the lifecycle tabs are
// here instead, as ?view= on this same route, so the person never gets dropped.
//
// Open to every member of the firm, not just owners. Making a person's name
// clickable across the app (which is the point) is worthless if half the firm
// gets a 404. The engagement and client lists are RLS-scoped, so a staff member
// sees the intersection of "their work" and "what I'm allowed to see" — the
// activity feed stays owner-only, mirroring /settings/audit.
const PROFILE_VIEWS = ["active", "ready", "completed", "archived"] as const;

// How many rows each section PREVIEWS on the overview before handing off to its
// own tab. One number for all three, so the cards stay the same height as each
// other instead of the page reading as a ragged column.
const OVERVIEW_PREVIEW = 5;
type ProfileView = (typeof PROFILE_VIEWS)[number];

function resolveProfileView(raw: string | undefined): ProfileView {
  return (PROFILE_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as ProfileView)
    : "active";
}

export default async function TeamMemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ view?: string; tab?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;
  const view = resolveProfileView(sp.view);
  // Which facet of this person we're looking at — the same treatment the client
  // page got, and for the same reason: this page had become one long scroll
  // through about / roles / permissions / removal / work / clients / history.
  const tab = parseTeamProfileTab(sp.tab);

  const user = await getCurrentUser();
  if (!user) notFound();
  const isOwner = user.role === "owner";
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);
  if (!firm.team_enabled) notFound();

  // listFirmUsers is RLS-scoped to the firm, so an id that isn't in it is either
  // another firm's user or nonexistent — a 404 either way.
  const members = await listFirmUsers();
  const member = members.find((m) => m.id === id);
  if (!member) notFound();

  // Two engagement scopes at most, and usually one: loadEngagementWorklist is
  // React.cache'd per scope, so active/ready/completed all resolve to the same
  // single query. Only the Archived filter costs a second one. The stat row
  // stays pinned to the ACTIVE count on purpose — a headline number that
  // changes meaning when you switch filters isn't a headline, it's a second
  // copy of the table's length.
  //
  // The rest is gated by TAB. Every one of these used to run on every render,
  // which after the tabs landed would mean each tab switch paying for the
  // firm's whole client list and a 20-row activity read to show a permission
  // switch. That is the latency the founder hit on the client page's tabs, and
  // this page would have inherited it.
  const wantsWork = tab === "overview" || tab === "engagements";
  const wantsClients = tab === "overview" || tab === "clients";
  const wantsActivity = isOwner && (tab === "overview" || tab === "activity");
  const [
    activeWorklist,
    viewWorklist,
    clientsRaw,
    seriesByAssignee,
    activity,
    avatarUrl,
  ] = await Promise.all([
      // The Active count is in the About panel and in the removal dialog's
      // "they're holding N things" warning — both of which live in the rail,
      // and the rail is the overview.
      tab === "overview" ? loadEngagementWorklist("active") : [],
      wantsWork ? loadEngagementWorklist(scopeForView(view)) : [],
      wantsClients ? listClients() : [],
      // Recurring schedules this person holds (0940). Needed by the removal
      // dialog: a schedule keeps minting NEW work every cycle, so someone whose
      // whole footprint is repeating work would otherwise be reported as
      // holding NOTHING and be removed with no handover offered. That exact bug
      // is why the count exists on the roster; passing 0 here would have
      // reintroduced it the moment removal moved to this page.
      tab === "overview" ? countLiveSeriesByAssignee() : new Map<string, number>(),
      // The overview shows a preview, the tab shows the log. Asking for 20 rows
      // to render 5 is the cheaper of the two round-trips to get wrong.
      wantsActivity
        ? listActivityForFirm({
            actorId: id,
            limit: tab === "activity" ? 100 : OVERVIEW_PREVIEW,
          })
        : Promise.resolve([]),
      getBrandingImageUrl(member.avatar_path),
    ]);
  const activeCount = selectView(
    "active",
    selectAssignedTo(activeWorklist, id),
  ).length;
  const engagements = selectView(view, selectAssignedTo(viewWorklist, id));
  // Reassignment targets for the per-row "move it" control: active teammates
  // other than the person whose profile this is.
  const reassignTargets = members
    .filter((m) => !m.deactivated_at && m.id !== id)
    .map((m) => ({ id: m.id, name: userDisplayLabel(m) }));
  // Their clients: the ones assigned to them PLUS the ones they are on the team
  // of (1210). Assignment alone was the whole answer until membership existed;
  // leaving it that way would have this page showing one list while their
  // actual access follows another — two answers to the same question, and after
  // the list decides access, the wrong one would be the louder.
  const memberClientIds = wantsClients
    ? await listClientIdsForMember(id)
    : new Set<string>();
  const assigned = filterClientsByOwner(clientsRaw, id, "");
  const assignedIds = new Set(assigned.map((c) => c.id));
  const clients = [
    ...assigned,
    ...clientsRaw.filter(
      (c) => memberClientIds.has(c.id) && !assignedIds.has(c.id),
    ),
  ];

  // The Clients TAB renders the firm's real clients table, so it needs what
  // that table reads: per-client engagement tallies and the rows its expanded
  // drawer lists. One firm-wide engagement read, on this tab only — the same
  // shape /clients does, through the same shared builder so the two screens
  // cannot count differently.
  const clientTabEngagements =
    tab === "clients" ? await listEngagements({ scope: "active" }) : [];
  const clientIdsShown = new Set(clients.map((c) => c.id));
  const { summaries: clientSummaries, engagementsByClient } =
    buildClientEngagementIndex(
      // Narrowed to THIS person's clients before indexing: the drawer under a
      // row must show that client's work, and the badge counts are per client
      // anyway, so carrying the whole firm's rows through would be waste.
      clientTabEngagements.filter((e) => clientIdsShown.has(e.client_id)),
    );
  // Owner chips for the table's "Owner" column. The seat cap is 1–15, so
  // resolving every member's avatar once here is cheaper than the table doing
  // it per row — and it is what /clients already does.
  const memberAvatars = await Promise.all(
    tab === "clients"
      ? members.map((m) => getBrandingImageUrl(m.avatar_path))
      : [],
  );
  const clientOwners: Record<string, ClientOwner> = {};
  if (tab === "clients") {
    members.forEach((m, i) => {
      clientOwners[m.id] = {
        id: m.id,
        name: userDisplayLabel(m),
        avatarUrl: memberAvatars[i],
      };
    });
  }

  // The firm's roles, and which of them this person wears. Both empty until
  // 1260 is applied, which reads as "no roles yet" — the right answer either
  // way. Overview only: the badges render beside their name, which the header
  // shows on every tab, so the READ stays but the roles EDITOR is in the rail.
  const [firmRoles, heldRoleIds] = await Promise.all([
    listFirmRoles(),
    listRoleIdsForUser(id),
  ]);


  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");
  const tClients = await getTranslations("Clients");
  const tAudit = await getTranslations("Audit");
  const tEngagements = await getTranslations("Engagements");
  const tDashboard = await getTranslations("Dashboard");
  const tStage = await getTranslations("Stage");
  // "View all" — the preview→tab link. Lives in Home, which owns the correctly
  // worded en+fr pair; Dashboard's wl_view_all says "Browse all", which is
  // written for the worklist's own footer, not for a five-row preview card.
  const tHome = await getTranslations("Home");

  const knownActions = new Set<string>(AUDIT_ACTIONS as readonly string[]);
  const actionLabel = (key: string): string =>
    knownActions.has(key)
      ? tAudit(`action_${key}` as Parameters<typeof tAudit>[0])
      : key;

  const name = userDisplayLabel(member);

  return (
    <div className="max-w-6xl space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title"), href: "/settings/team" },
          { label: name },
        ]}
      />

      <header className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <AvatarInitials src={avatarUrl} name={name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <Badge variant={member.role === "owner" ? "default" : "secondary"}>
              {member.role === "owner" ? t("role_owner") : t("role_staff")}
            </Badge>
            {member.deactivated_at && (
              <Badge variant="outline">{t("profile_deactivated")}</Badge>
            )}
            {/* Their firm roles, beside their name and visible to everyone —
                the whole point of a badge. Renders nothing when they have none
                rather than leaving a gap. */}
            <RoleBadges
              roles={firmRoles.filter((r) => heldRoleIds.has(r.id))}
            />
          </div>
          {member.job_title && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {member.job_title}
            </p>
          )}
        </div>
      </div>

      {/* The same tab row the client page has, from the same component. The
          header card's bottom edge was left empty when the lifecycle filter
          moved down to the list it filters ("the main headers should be main
          headers"); this is the page-level thing that earns it back.
          Activity is owner-only — it mirrors /settings/audit's visibility, and
          a tab that 404s half the firm is worse than no tab. */}
      <ProfileTabs
        label={name}
        items={[
          { key: "overview", href: teamProfileTabHref(id, "overview"), label: tClients("tab_overview"), active: tab === "overview" },
          { key: "engagements", href: teamProfileTabHref(id, "engagements"), label: t("profile_engagements_title"), active: tab === "engagements" },
          { key: "clients", href: teamProfileTabHref(id, "clients"), label: t("profile_clients_title"), active: tab === "clients" },
          ...(isOwner
            ? [
                { key: "activity", href: teamProfileTabHref(id, "activity"), label: t("profile_activity_title"), active: tab === "activity" },
                { key: "access", href: teamProfileTabHref(id, "access"), label: t("tab_access"), active: tab === "access" },
              ]
            : []),
        ]}
      />
      </header>

      {/* Two columns on the OVERVIEW, same shape as a client's page and
          following Canopy's profile layout: a narrow rail of quiet reference
          on the left, the person's actual WORK on the right.
          Every other tab is one full-width column — a rail of "about" beside a
          table you came to read is the "you just moved the block" problem the
          founder called out, one level up. */}
      <div
        className={
          tab === "overview"
            ? "grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start"
            : ""
        }
      >

      {/* ── Left rail (overview only) ────────────────────────────────────── */}
      {tab === "overview" && (
      <div className="space-y-4">
        <Panel title={t("profile_about_title")}>
          {/* The three big number tiles that used to sit here are gone. A row
              of oversized figures across the top is the "AI-generated dashboard"
              look the founder has rejected before; the same numbers read fine as
              quiet label/value rows, and they are reference, not the point. */}
          <dl className="mt-3 space-y-3 text-sm">
            <ProfileRow label={tClients("col_email")} value={member.email} />
            {/* Read-only, deliberately. Founder: "wouldn't that be Clarence
                that does that?" — a job title somebody assigned you without
                asking is a strange thing for a product to enable, and hours you
                did not agree to are worse. Both are set by the person on their
                own /profile and read here from the same row, so the two pages
                cannot disagree. */}
            <ProfileRow
              label={t("profile_job_title")}
              value={member.job_title?.trim() || t("profile_not_recorded")}
            />
            <ProfileRow
              label={t("profile_weekly_hours")}
              value={
                member.weekly_hours == null
                  ? t("profile_not_recorded")
                  : t("profile_hours_value", { hours: member.weekly_hours })
              }
            />
            <ProfileRow
              label={t("profile_stat_engagements")}
              value={String(activeCount)}
            />
            <ProfileRow
              label={t("profile_stat_clients")}
              value={String(clients.length)}
            />
            {isOwner && (
              <ProfileRow
                label={t("profile_stat_activity")}
                value={String(activity.length)}
              />
            )}
          </dl>
        </Panel>

        {/* Owner actions on this person, together, at the bottom of the rail —
            the two heaviest things you can do to a teammate, kept away from the
            first thing you meet. Removing them used to be a "..." menu item on
            the firm roster; it lives here now because the roster row became a
            button and a menu inside a button is a mis-click waiting to happen
            (and because Karbon puts every colleague action on the colleague's
            own page). */}
        {isOwner && (
          <div className="space-y-2">
            <HandOverWork
              fromUserId={id}
              fromName={name}
              members={reassignTargets}
              counts={{ engagements: activeCount, clients: clients.length }}
            />
            {/* Never on your own profile, and never on the owner's: the server
                refuses both, and offering a button that always errors is worse
                than not offering it. */}
            {!member.deactivated_at &&
              member.id !== user.id &&
              member.role !== "owner" && (
                <DeactivateMember
                  memberId={id}
                  memberName={name}
                  activeEngagements={activeCount}
                  clientCount={clients.length}
                  scheduleCount={seriesByAssignee.get(id) ?? 0}
                  reassignTargets={reassignTargets}
                />
              )}
          </div>
        )}
      </div>
      )}

      {/* ── Main column: their work ──────────────────────────────────────── */}
      <div className="space-y-6">
      {/* ── ACCESS TAB: roles, and the one per-person override ─────────────
          Gets the two owner-only controls out of the overview rail, which is
          reference. They were tucked there under a comment saying controls live
          quietly on the object they act on — they still do; the object is this
          page, and now they have room.

          IT SHIPPED WITH A THIRD THING AND THE FOUNDER KILLED IT, correctly: a
          read-only "What they can do" table listing all nine capabilities with
          where each came from. Beside a panel of two switches it read as seven
          broken switches — "either remove it or add switches to make it
          functional".

          Adding the other seven was never an option. Each is refused for its
          own reason in lib/auth/grantable.ts: not RLS-backed (team.manage),
          RLS-DECIDED so an app-level grant would change the UI and nothing the
          database returns (clients.private), owner-only by the founder's call
          twice (audit.view), not per-person by nature (firm.settings), or the
          feature does not exist yet (time.approve). Switches for those would be
          controls that lie.

          And the table was a THIRD permission surface in a model the founder
          already settled: "there shouldn't be two ways of having permissions —
          permissions should exist purely based off roles". ROLES are the
          switchboard; the panel below keeps ONE per-person override for handing
          somebody one thing without inventing a role for them. Both read from
          the same GRANTABLE_CAPABILITIES list, so they cannot drift.

          "Where it comes from" did not die with the table — MemberPermissions
          already names the role a capability arrives from, and kills that
          switch rather than letting it promise a revocation the model cannot
          express (grants only ever add). That is the answer to "why can she do
          that", attached to the control instead of to a report beside it. */}
      {tab === "access" && isOwner && (
        <div className="max-w-2xl space-y-4">
      {/* The badges this person wears. Owner-only to change, and shown to
          everybody on the header above — a badge only the owner can see is
          not a badge. Separate panel from Permissions on purpose: one says
          what somebody IS, the other what they may DO, and this app has
          already confused those two words once. */}
      {isOwner && !member.deactivated_at && (
        <Panel title={t("roles_title")}>
          <MemberRoles
            userId={id}
            allRoles={firmRoles}
            heldIds={[...heldRoleIds]}
            disabled={firmRoles.length === 0}
          />
        </Panel>
      )}

      {/* What this person is allowed to do. Owner-only, and never on the
          owner's own row or a deactivated one — the server refuses both, and
          a control that always errors is worse than no control.
          Tucked in the rail rather than given a section of its own: the
          founder's standing rule is that a control lives quietly on the
          object it acts on. */}
      {isOwner &&
        !member.deactivated_at &&
        member.role !== "owner" &&
        member.id !== user.id && (
          <Panel title={t("permissions_title")}>
            <MemberPermissions
              userId={id}
              grants={member.extra_capabilities}
              // What their ROLES already grant, so the panel can name the
              // source rather than showing a switch with no explanation.
              fromRoles={firmRoles
                .filter(
                  (r) => heldRoleIds.has(r.id) && r.capabilities.length > 0,
                )
                .map((r) => ({
                  name: r.name,
                  color: r.color,
                  capabilities: [...r.capabilities],
                }))}
              // Migration 1120 not applied yet → the column comes back
              // undefined. The switches still render (so the feature is
              // discoverable) but writing would fail, so they are disabled
              // with the "available in a moment" message the firm settings
              // already use for exactly this situation.
              disabled={member.extra_capabilities === undefined}
            />
          </Panel>
        )}
        </div>
      )}

      {/* The lifecycle filter belongs HERE, on the list it filters — not in the
          header card. Founder, seeing it at the top: "the main headers should
          be main headers", and a filter for one section is not one.
          On the TAB this is the real list: the same searchable, stage-filtered
          browser the client page's Engagements tab uses, because "everything
          this person is working on" deserves the same tools as "everything for
          this client". On the OVERVIEW it is a five-row preview with a way in. */}
      {(tab === "overview" || tab === "engagements") && (
      <Panel
        title={t("profile_engagements_title")}
        flush
        aside={
          tab === "engagements" ? (
            <FilterLinks
              label={t("profile_engagements_title")}
              items={PROFILE_VIEWS.map((v) => ({
                key: v,
                href: `${teamProfileTabHref(id, "engagements")}${v === "active" ? "" : `&view=${v}`}`,
                label: tEngagements(
                  viewLabelKey(v) as Parameters<typeof tEngagements>[0],
                ),
                active: v === view,
              }))}
            />
          ) : engagements.length > OVERVIEW_PREVIEW ? (
            <Link
              href={teamProfileTabHref(id, "engagements")}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {tHome("view_all")}
            </Link>
          ) : null
        }
      >
        {tab === "engagements" ? (
          <WorklistBrowser
            rows={engagements}
            locale={locale}
            emptyText={t("profile_no_engagements", { name })}
            emptySearchText={tDashboard("wl_empty_search")}
            emptyStageText={tStage("empty_for_stage")}
            // The one place searching by CLIENT is the useful thing: every row
            // here is a different client, which is the opposite of the client
            // page where the name is identical on all of them.
            searchClientNames
            teamEnabled={false}
            reassignMembers={reassignTargets}
            viewerId={user.id}
          />
        ) : (
          <WorklistTable
            rows={engagements.slice(0, OVERVIEW_PREVIEW)}
            locale={locale}
            emptyText={t("profile_no_engagements", { name })}
            growNameColumn
            teamEnabled={false}
            reassignMembers={reassignTargets}
            viewerId={user.id}
          />
        )}
      </Panel>
      )}

      {/* Their clients. On the TAB this is the firm's REAL clients table —
          expandable rows showing that client's work, the owner chip, the row
          menu — filtered to the ones this person owns or is on the team of.
          Not a lookalike list: the same component /clients renders, fed through
          the same shared index, so the two screens can never count differently.
          On the overview it stays a five-row preview with a way in. */}
      {(tab === "overview" || tab === "clients") && (
      <Panel
        title={`${t("profile_clients_title")}${tab === "clients" ? ` (${clients.length})` : ""}`}
        flush={tab === "clients"}
        aside={
          tab === "overview" && clients.length > OVERVIEW_PREVIEW ? (
            <Link
              href={teamProfileTabHref(id, "clients")}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {tHome("view_all")}
            </Link>
          ) : null
        }
      >
        {clients.length === 0 ? (
          <p className={tab === "clients" ? "px-4 py-6 text-sm text-muted-foreground" : "text-sm text-muted-foreground"}>
            {t("profile_no_clients", { name })}
          </p>
        ) : tab === "clients" ? (
          <ClientsTable
            clients={clients}
            summaries={clientSummaries}
            engagementsByClient={engagementsByClient}
            owners={clientOwners}
            currentUserId={user.id}
            locale={locale}
            teamEnabled
          />
        ) : (
          <ul className="-mx-4 -my-1 divide-y divide-border/40">
            {clients.slice(0, OVERVIEW_PREVIEW).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/40"
                >
                  <span className="truncate text-sm font-medium">
                    {c.display_name}
                  </span>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {c.type === "individual"
                      ? tClients("type_individual")
                      : tClients("type_business")}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      )}

      {/* What they've done. Owner-only, mirroring /settings/audit — the founder's
          standing call is that history is not something staff surveil each
          other with. The overview previews five; the tab is the log. */}
      {isOwner && (tab === "overview" || tab === "activity") && (
      <Panel
        title={t("profile_activity_title")}
        aside={
          tab === "overview" && activity.length >= OVERVIEW_PREVIEW ? (
            <Link
              href={teamProfileTabHref(id, "activity")}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {tHome("view_all")}
            </Link>
          ) : null
        }
      >
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("profile_no_activity", { name })}
          </p>
        ) : (
          <ol className="-mx-4 -my-1 divide-y divide-border/40">
            {activity.map((e) => {
              const context = e.engagement_title ?? e.client_display_name ?? null;
              const href = e.engagement_id
                ? `/engagements/${e.engagement_id}`
                : e.client_id
                  ? `/clients/${e.client_id}`
                  : null;
              const body = (
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm">{actionLabel(e.action)}</div>
                    {context && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {context}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDate(e.created_at, locale, "medium")}
                  </span>
                </div>
              );
              return (
                <li key={e.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="block transition-colors hover:bg-secondary/40"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      )}
      </div>
      </div>
    </div>
  );
}

// Same titled box as the client page — every section its own bordered card
// with a header band, which is the shape of Canopy's whole profile.

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular-nums">
        {value}
      </dd>
    </div>
  );
}
