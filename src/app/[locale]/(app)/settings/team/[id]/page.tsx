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
import { filterClientsByOwner } from "@/components/clients/owner";
import { listActivityForFirm } from "@/lib/db/activity";
import {
  AUDIT_ACTIONS,
} from "@/components/settings/audit-actions";
import { getBrandingImageUrl } from "@/lib/storage";
import { WorklistTable } from "@/components/dashboard/engagements-worklist";
import { HandOverWork } from "@/components/settings/team/hand-over-work";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { formatDate } from "@/lib/format";

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
  searchParams: Promise<{ view?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const view = resolveProfileView((await searchParams).view);

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

  // Two scopes at most, and usually one: loadEngagementWorklist is React.cache'd
  // per scope, so active/ready/completed all resolve to the same single query.
  // Only the Archived tab costs a second one. The stat tile stays pinned to the
  // ACTIVE count on purpose — a headline number that changes meaning when you
  // switch tabs isn't a headline, it's a second copy of the table's length.
  const [activeWorklist, viewWorklist, clientsRaw, activity, avatarUrl] =
    await Promise.all([
      loadEngagementWorklist("active"),
      loadEngagementWorklist(scopeForView(view)),
      listClients(),
      isOwner
        ? listActivityForFirm({ actorId: id, limit: 20 })
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
  // filterClientsByOwner treats a non-"all"/"mine" value as a member id; the
  // third arg (current user) is unused for a member-id filter.
  const clients = filterClientsByOwner(clientsRaw, id, "");

  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");
  const tClients = await getTranslations("Clients");
  const tAudit = await getTranslations("Audit");
  const tEngagements = await getTranslations("Engagements");

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
          </div>
        </div>
      </div>

      {/* The lifecycle tabs move OUT of the engagements section and onto the
          header card's bottom edge — Canopy's treatment, and the reason the
          founder pointed at that screenshot: "how you can view, like, active
          engagements". They were a cluster of small pills floating beside a
          section heading; here they read as what they are, the page's own
          sections. */}
      <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-2">
        {PROFILE_VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "active" ? `/settings/team/${id}` : `/settings/team/${id}?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={
              v === view
                ? "-mb-px whitespace-nowrap border-b-2 border-foreground px-3 py-2.5 text-sm font-medium text-foreground"
                : "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {tEngagements(viewLabelKey(v) as Parameters<typeof tEngagements>[0])}
          </Link>
        ))}
      </nav>
      </header>

      {/* Two columns, same shape as a client's page and following Canopy's
          profile layout: a narrow rail of quiet reference on the left, the
          person's actual WORK on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">

      {/* ── Left rail ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Panel title={t("profile_about_title")}>
          {/* The three big number tiles that used to sit here are gone. A row
              of oversized figures across the top is the "AI-generated dashboard"
              look the founder has rejected before; the same numbers read fine as
              quiet label/value rows, and they are reference, not the point. */}
          <dl className="mt-3 space-y-3 text-sm">
            <ProfileRow label={tClients("col_email")} value={member.email} />
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

        {/* Bulk assign. Owner-only, and it renders itself away when there is
            nothing to move or nobody to move it to. */}
        {isOwner && (
          <HandOverWork
            fromUserId={id}
            fromName={name}
            members={reassignTargets}
            counts={{ engagements: activeCount, clients: clients.length }}
          />
        )}
      </div>

      {/* ── Main column: their work ──────────────────────────────────────── */}
      <div className="space-y-6">
      <Panel title={t("profile_engagements_title")} flush>
        <WorklistTable
          rows={engagements}
          locale={locale}
          emptyText={t("profile_no_engagements", { name })}
          growNameColumn
          teamEnabled={false}
          reassignMembers={reassignTargets}
          viewerId={user.id}
        />
      </Panel>

      <Panel title={t("profile_clients_title")}>
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("profile_no_clients", { name })}
          </p>
        ) : (
          <ul className="-mx-4 -my-1 divide-y divide-border/40">
            {clients.slice(0, 8).map((c) => (
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

      {isOwner && (
      <Panel title={t("profile_activity_title")}>
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
function Panel({
  title,
  flush = false,
  children,
}: {
  title: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="border-b border-border/60 px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

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
