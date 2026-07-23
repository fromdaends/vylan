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
import {
  TeamWorkloadTable,
  type TeamWorkloadRow,
} from "@/components/settings/team/team-workload-table";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { listClients } from "@/lib/db/clients";
import {
  computeEngagementWorkload,
  workloadForMember,
} from "@/lib/team/workload";

export const dynamic = "force-dynamic";

// Team page. Owners get the full manager (invite / deactivate / transfer /
// seats); staff get a READ-ONLY roster of who's on the team. The server
// actions + /api routes still reject staff, so this read-only UI is safe.
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  // Owners manage; staff only view. firm_invites + seat usage are owner-only
  // (RLS) — staff would just get empty results, so skip those fetches for them.
  const canManage = user.role === "owner";
  const [members, invites, usage] = await Promise.all([
    listFirmUsers(),
    canManage ? listFirmInvites() : Promise.resolve([]),
    canManage ? getFirmSeatUsage(firm.id) : Promise.resolve(null),
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

  if (!firm.team_enabled) {
    return (
      <div className="space-y-8">
        {breadcrumb}
        <TeamSetup firmName={firm.name} />
      </div>
    );
  }

  const nameById = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));

  // Resolve each member's avatar once so the roster shows real profile
  // pictures (AvatarInitials falls back to initials when the URL is null).
  const memberAvatars = await Promise.all(
    members.map((m) => getBrandingImageUrl(m.avatar_path)),
  );
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
  let workloadRows: TeamWorkloadRow[] = [];
  let workloadUnassigned = {
    activeEngagements: 0,
    readyToReview: 0,
    needsAttention: 0,
  };
  // Members handed to the roster manager — enriched (owners only) with each
  // person's live-work counts so the guarded-offboarding remove dialog can show
  // "holds N engagements / M clients" and offer to reassign it.
  type ManagerMember = (typeof activeMembers)[number] & {
    activeEngagements?: number;
    clients?: number;
  };
  let membersForManager: ManagerMember[] = activeMembers;
  if (canManage) {
    const [worklist, clientsRaw] = await Promise.all([
      loadEngagementWorklist("active"),
      listClients(),
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
    workloadRows = activeMembers.map((m) => {
      const w = workloadForMember(byMember, m.id);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        avatarUrl: m.avatarUrl,
        activeEngagements: w.activeEngagements,
        readyToReview: w.readyToReview,
        needsAttention: w.needsAttention,
        clients: clientCountByOwner.get(m.id) ?? 0,
      };
    });
    membersForManager = activeMembers.map((m) => ({
      ...m,
      activeEngagements: workloadForMember(byMember, m.id).activeEngagements,
      clients: clientCountByOwner.get(m.id) ?? 0,
    }));
  }

  return (
    <div className="space-y-8">
      {breadcrumb}
      {canManage && workloadRows.length > 0 && (
        <TeamWorkloadTable rows={workloadRows} unassigned={workloadUnassigned} />
      )}
      <TeamManager
        firmName={firm.name}
        canManage={canManage}
        onTrial={isOnTrial(firm)}
        seat={seat}
        activeMembers={membersForManager}
        deactivatedMembers={deactivatedMembers}
        pendingInvites={pendingInvites}
        locale={locale}
      />
    </div>
  );
}
