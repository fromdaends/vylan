import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmInvites } from "@/lib/db/invites";
import { getFirmSeatUsage } from "@/lib/billing/seats";
import { inviteState } from "@/lib/team/invites";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { TeamManager } from "@/components/settings/team/team-manager";

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

  const nameById = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));

  const activeMembers = members
    .filter((m) => !m.deactivated_at)
    .map((m) => ({
      id: m.id,
      name: userDisplayLabel(m),
      email: m.email,
      role: m.role,
      isSelf: m.id === user.id,
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

  return (
    <div className="space-y-8">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title") },
        ]}
      />
      <TeamManager
        canManage={canManage}
        seat={seat}
        activeMembers={activeMembers}
        deactivatedMembers={deactivatedMembers}
        pendingInvites={pendingInvites}
        locale={locale}
      />
    </div>
  );
}
