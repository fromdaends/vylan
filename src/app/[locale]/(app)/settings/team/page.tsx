import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { isOnTrial } from "@/lib/trial";
import { listFirmInvites } from "@/lib/db/invites";
import { getFirmSeatUsage } from "@/lib/billing/seats";
import { inviteState } from "@/lib/team/invites";
import { getBrandingImageUrl } from "@/lib/storage";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import {
  TeamManager,
  TeamSetup,
} from "@/components/settings/team/team-manager";
import { TeamSettings } from "@/components/settings/team/firm-settings";
import { FirmSettingsSections } from "@/components/settings/firm-settings-sections";
import { FirmTabs } from "@/components/firm/firm-tabs";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { listClients } from "@/lib/db/clients";
import { countLiveSeriesByAssignee } from "@/lib/db/recurring";
import {
  computeEngagementWorkload,
  workloadForMember,
} from "@/lib/team/workload";
import { listFirmRoles, listRolesByUser } from "@/lib/db/firm-roles";
import { RolesWorkbench } from "@/components/settings/team/roles-workbench";
import { can } from "@/lib/auth/capabilities";

export const dynamic = "force-dynamic";

// Team page. Owners get the full manager (invite / deactivate / transfer /
// seats); staff get a READ-ONLY roster of who's on the team. The server
// actions + /api routes still reject staff, so this read-only UI is safe.
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // `role` is the Roles tab's selection — RolesWorkbench writes it by mutating
  // the current URL, so it rides alongside `tab` rather than replacing it.
  searchParams: Promise<{ tab?: string; role?: string }>;
}) {
  const { locale: rawLocale } = await params;
  // Which tab. Anything unrecognised falls back to the roster rather than a
  // blank page — a bad ?tab= should never cost you the screen.
  const sp = await searchParams;
  const requestedTab = sp.tab;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  // Owners manage; staff only view. firm_invites + seat usage are owner-only
  // (RLS) — staff would just get empty results, so skip those fetches for them.
  // team.manage, not the rank. The server side (actions/team.ts, the roles
  // page, /api routes) already asks this question via can(); the screen asking a
  // different one is how a granted role ends up hiding its own controls.
  const canManage = can(user, "team.manage");
  // Only owners have a Firm tab (every block on it is owner-gated), so a staff
  // member arriving on ?tab=firm falls back to the roster rather than a blank
  // page. An unrecognised value falls back the same way.
  // Roles is owner-only for the same reason its old standalone route was: the
  // settings on it decide what everyone wearing a role may do, so deciding them
  // cannot be one of the things other people may do. It also needs a team —
  // with collaboration off there is nobody to wear a role.
  const view: "people" | "settings" | "roles" =
    canManage && requestedTab === "settings"
      ? "settings"
      : canManage && firm.team_enabled === true && requestedTab === "roles"
        ? "roles"
        : "people";
  const [members, invites, usage, rolesByUser, firmRoles] = await Promise.all([
    listFirmUsers(),
    canManage ? listFirmInvites() : Promise.resolve([]),
    canManage ? getFirmSeatUsage(firm.id) : Promise.resolve(null),
    // Who wears what — the badges on the roster, needed on every tab.
    listRolesByUser(),
    // The roles THEMSELVES, only for the tab that lists them. Loading them on
    // the roster too is exactly the wasted await that made the client tabs
    // slow before #1159 gated them.
    view === "roles"
      ? listFirmRoles()
      : Promise.resolve([] as Awaited<ReturnType<typeof listFirmRoles>>),
  ]);
  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  const breadcrumb = (
    <Breadcrumb
      label={tCommon("breadcrumb")}
      items={[
        { label: tApp("nav_settings"), href: "/settings" },
        { label: t("title") },
      ]}
    />
  );

  // A SOLO firm (team mode off — the default for every new signup, migration
  // 0540) used to get nothing here but the "create a team" card: no header, no
  // tabs. That was fine while the firm's identity was edited on the settings
  // screen, and became a trap the moment it moved here — a solo owner could no
  // longer change their firm's name, logo, brand colour or client email
  // language anywhere at all. A firm has an identity whether or not it has
  // staff, so the page keeps its shape; only the team-shaped parts stand down.
  const teamEnabled = firm.team_enabled === true;

  const nameById = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));

  // Invert "who holds what" into "who is on this role" once, here, rather than
  // making the Roles tab do it per render. Lifted verbatim from the standalone
  // roles route this tab replaces.
  const memberIdsByRole = new Map<string, string[]>();
  for (const [userId, held] of rolesByUser) {
    for (const r of held) {
      memberIdsByRole.set(r.id, [...(memberIdsByRole.get(r.id) ?? []), userId]);
    }
  }

  // Resolve each member's avatar once so the roster shows real profile
  // pictures (AvatarInitials falls back to initials when the URL is null).
  // The FIRM's own logo rides in the same batch — it feeds both the page
  // header and the identity editor on the Settings tab, and signing it
  // separately would be one more sequential round trip for one more image.
  const [firmLogoUrl, ...memberAvatars] = await Promise.all([
    getBrandingImageUrl(firm.logo_url),
    ...members.map((m) => getBrandingImageUrl(m.avatar_path)),
  ]);
  const avatarById = new Map(members.map((m, i) => [m.id, memberAvatars[i]]));

  const activeMembers = members
    .filter((m) => !m.deactivated_at)
    .map((m) => ({
      id: m.id,
      name: userDisplayLabel(m),
      email: m.email,
      role: m.role,
      isSelf: m.id === user.id,
      avatarUrl: avatarById.get(m.id) ?? null,
      isExternal: m.is_external === true,
    }))
    // Owner first, then the rest alphabetically.
    .sort((a, b) =>
      a.role === b.role
        ? a.name.localeCompare(b.name)
        : a.role === "owner"
          ? -1
          : 1,
    );

  const deactivatedMembers = members
    .filter((m) => m.deactivated_at)
    .map((m) => ({
      id: m.id,
      name: userDisplayLabel(m),
      email: m.email,
      avatarUrl: avatarById.get(m.id) ?? null,
      deactivatedAt: m.deactivated_at,
      deactivatedByName: m.deactivated_by_user_id
        ? (nameById.get(m.deactivated_by_user_id) ?? null)
        : null,
    }));

  const pendingInvites = invites.map((inv) => ({
    id: inv.id,
    email: inv.email,
    invitedByName: inv.invited_by_user_id
      ? (nameById.get(inv.invited_by_user_id) ?? null)
      : null,
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
    // inviteState defaults to the current time internally (keeps Date.now() out
    // of the component render — see react-hooks/purity).
    expired: inviteState(inv) === "expired",
  }));

  // Infinity (an unlimited plan) isn't JSON-serializable — pass cap as null.
  // usage is null for staff (the read-only view never renders seats), so fall
  // back to a harmless placeholder.
  const cap = usage && Number.isFinite(usage.cap) ? usage.cap : null;
  const seat = {
    used: usage?.total ?? 0,
    cap,
    atCap: cap != null && (usage?.total ?? 0) >= cap,
  };

  // Team Wave 2: the owner-only workload roll-up — one row per active member
  // (active engagements, ready-to-review, needs-attention, clients). Load the
  // firm's active worklist + clients ONCE and bucket per assignee. Owner-only, so
  // staff never pay for the worklist scan.
  let workloadUnassigned = {
    activeEngagements: 0,
    readyToReview: 0,
    needsAttention: 0,
  };
  // Members handed to the roster manager — enriched (owners only) with each
  // person's live workload (active / ready-to-review / needs-attention / clients)
  // so the roster row can show it inline AND the guarded-offboarding dialog can
  // offer to reassign their work.
  type ManagerMember = (typeof activeMembers)[number] & {
    activeEngagements?: number;
    readyToReview?: number;
    needsAttention?: number;
    clients?: number;
    schedules?: number;
    roles?: { id: string; name: string; color: string }[];
  };
  // The roster is where you scan the team, so the badges belong there as much
  // as on a profile. Attached for owners and staff alike — a badge only some
  // people can see is not a badge.
  let membersForManager: ManagerMember[] = activeMembers.map((m) => ({
    ...m,
    roles: rolesByUser.get(m.id) ?? [],
  }));
  // Solo firms show the setup card instead of a roster, so the whole workload
  // roll-up behind it — a firm-wide worklist scan, every client, every
  // recurring series — would be three queries paying for a table nobody sees.
  if (canManage && teamEnabled) {
    const [worklist, clientsRaw, seriesByAssignee] = await Promise.all([
      loadEngagementWorklist("active"),
      listClients(),
      // Recurring schedules per person (0940). Counted here so the guarded
      // offboarding dialog offers a handover to someone whose whole footprint
      // is repeating work — before this they reported as holding nothing.
      countLiveSeriesByAssignee(),
    ]);
    const { byMember, unassigned } = computeEngagementWorkload(
      worklist.map((w) => ({
        assigneeUserId: w.assigneeUserId,
        readyToReview: w.readyToReview,
        daysOverdue: w.daysOverdue,
      })),
    );
    workloadUnassigned = unassigned;
    const clientCountByOwner = new Map<string, number>();
    for (const c of clientsRaw) {
      if (c.assigned_user_id) {
        clientCountByOwner.set(
          c.assigned_user_id,
          (clientCountByOwner.get(c.assigned_user_id) ?? 0) + 1,
        );
      }
    }
    membersForManager = membersForManager.map((m) => {
      const w = workloadForMember(byMember, m.id);
      return {
        ...m,
        activeEngagements: w.activeEngagements,
        readyToReview: w.readyToReview,
        needsAttention: w.needsAttention,
        clients: clientCountByOwner.get(m.id) ?? 0,
        schedules: seriesByAssignee.get(m.id) ?? 0,
      };
    });
  }

  return (
    <div className="space-y-8">
      {breadcrumb}
      <TeamManager
        view={view}
        teamEnabled={teamEnabled}
        setupCard={!teamEnabled ? <TeamSetup firmName={firm.name} /> : null}
        tabs={
          canManage ? (
            <FirmTabs
              current={view}
              teamEnabled={teamEnabled}
              labels={{
                people: t("tab_people"),
                roles: t("roles_title"),
                settings: tApp("nav_settings"),
              }}
            />
          ) : undefined
        }
        firmName={firm.name}
        firmLogoUrl={firmLogoUrl}
        firmBrandColor={firm.brand_color}
        canManage={canManage}
        onTrial={isOnTrial(firm)}
        seat={seat}
        activeMembers={membersForManager}
        deactivatedMembers={deactivatedMembers}
        pendingInvites={pendingInvites}
        locale={locale}
        unassignedWorkload={canManage ? workloadUnassigned : undefined}
        rolesBoard={
          view === "roles" ? (
            <RolesWorkbench
              roles={firmRoles.map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
                capabilities: r.capabilities,
                isOwnerRole: r.isOwnerRole,
                memberIds: memberIdsByRole.get(r.id) ?? [],
              }))}
              people={activeMembers.map((m) => ({
                id: m.id,
                name: m.name,
                email: m.email,
              }))}
              selectedId={sp.role ?? null}
            />
          ) : null
        }
        firmSettings={
          canManage ? (
            <>
              {/* The firm's IDENTITY — name, logo, brand colour, the language
                  clients are emailed in. It used to render under Settings →
                  Account, which meant "edit the firm" and "the firm's
                  settings" were two different screens; the founder's rule for
                  this page is one place you look at per thing. This is the
                  SAME component that screen rendered, moved — not a second
                  copy of the form, which is how the two surfaces would drift
                  the first time either one changed. */}
              <FirmSettingsSections
                firm={{
                  name: firm.name,
                  brand_color: firm.brand_color,
                  locale_default: firm.locale_default === "en" ? "en" : "fr",
                  // `?? null` rather than a bare read: this ships before
                  // migration 1750 is applied, and a missing column has to mean
                  // "not set" instead of blowing up the settings page.
                  province: firm.province ?? null,
                }}
                firmLogoUrl={firmLogoUrl}
              />
              {/* The two firm-wide switches are about OTHER PEOPLE — who can
                  see which client, who gets told about an assignment. With
                  team mode off there is nobody they could apply to, so they
                  stand down while the identity above stays. */}
              {teamEnabled && (
                <>
                  <div className="my-8 border-t border-border/60" />
                  <TeamSettings
                    clientsPrivateByDefault={
                      firm.clients_private_by_default === true
                    }
                    notifyOnAssignment={firm.notify_on_assignment !== false}
                    // The surrounding tab is gated on team.manage, but
                    // setInvitePolicy hard-requires the OWNER — so this asks
                    // the narrower question rather than showing a manager a
                    // radio the server will refuse.
                    invitePolicy={
                      user.role === "owner"
                        ? firm.invite_policy === "members"
                          ? "members"
                          : "owner"
                        : null
                    }
                  />
                </>
              )}
            </>
          ) : null
        }
      />
    </div>
  );
}
