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
import { listClients } from "@/lib/db/clients";
import { filterClientsByOwner } from "@/components/clients/owner";
import { listActivityForFirm } from "@/lib/db/activity";
import {
  AUDIT_ACTIONS,
} from "@/components/settings/audit-actions";
import { getBrandingImageUrl } from "@/lib/storage";
import { WorklistTable } from "@/components/dashboard/engagements-worklist";
import { EngagementReassignMenu } from "@/components/engagements/engagement-reassign-menu";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { formatDate } from "@/lib/format";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

// A teammate's profile — "everything they're doing" in one place. Owner-only
// (mirrors /settings/audit: it surfaces the same activity data), team-mode-only.
// The engagement + client lists reuse the same filters as the ?assignee= /
// ?owner= list views, and the "view all" links deep-link straight to them.
export default async function TeamMemberProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user || user.role !== "owner") notFound();
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);
  if (!firm.team_enabled) notFound();

  // listFirmUsers is RLS-scoped to the firm, so an id that isn't in it is either
  // another firm's user or nonexistent — a 404 either way.
  const members = await listFirmUsers();
  const member = members.find((m) => m.id === id);
  if (!member) notFound();

  const [worklist, clientsRaw, activity, avatarUrl] = await Promise.all([
    loadEngagementWorklist("active"),
    listClients(),
    listActivityForFirm({ actorId: id, limit: 20 }),
    getBrandingImageUrl(member.avatar_path),
  ]);
  const engagements = selectAssignedTo(worklist, id);
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

  const knownActions = new Set<string>(AUDIT_ACTIONS as readonly string[]);
  const actionLabel = (key: string): string =>
    knownActions.has(key)
      ? tAudit(`action_${key}` as Parameters<typeof tAudit>[0])
      : key;

  const name = userDisplayLabel(member);

  return (
    <div className="max-w-4xl space-y-8">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title"), href: "/settings/team" },
          { label: name },
        ]}
      />

      <header className="flex flex-wrap items-start gap-4">
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
          <p className="mt-1 text-sm text-muted-foreground">{member.email}</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label={t("profile_stat_engagements")}
          value={engagements.length}
        />
        <StatTile label={t("profile_stat_clients")} value={clients.length} />
        <StatTile
          label={t("profile_stat_activity")}
          value={activity.length}
        />
      </div>

      <section className="space-y-3">
        <SectionHeader
          title={t("profile_engagements_title")}
          href={`/engagements?assignee=${id}`}
          viewAllLabel={t("profile_view_all")}
        />
        <WorklistTable
          rows={engagements}
          locale={locale}
          emptyText={t("profile_no_engagements", { name })}
          growNameColumn
          teamEnabled={false}
          rowAction={
            reassignTargets.length > 0
              ? (row) => (
                  <EngagementReassignMenu
                    engagementId={row.id}
                    members={reassignTargets}
                  />
                )
              : undefined
          }
        />
      </section>

      <section className="space-y-3">
        <SectionHeader
          title={t("profile_clients_title")}
          href={`/clients?owner=${id}`}
          viewAllLabel={t("profile_view_all")}
        />
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("profile_no_clients", { name })}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/50">
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
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          {t("profile_activity_title")}
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("profile_no_activity", { name })}
          </p>
        ) : (
          <ol className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/50">
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
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionHeader({
  title,
  href,
  viewAllLabel,
}: {
  title: string;
  href: string;
  viewAllLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {viewAllLabel}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
