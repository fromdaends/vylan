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

// Owner-only team management. Staff are bounced to their settings (the server
// actions + /api routes reject them too; this is the matching UI gate).
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user || user.role !== "owner") {
    redirect(`/${locale}/settings`);
  }
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  const [members, invites, usage] = await Promise.all([
    listFirmUsers(),
    listFirmInvites(),
    getFirmSeatUsage(firm.id),
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
  const cap = Number.isFinite(usage.cap) ? usage.cap : null;
  const seat = {
    used: usage.total,
    cap,
    atCap: cap != null && usage.total >= cap,
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
        seat={seat}
        activeMembers={activeMembers}
        deactivatedMembers={deactivatedMembers}
        pendingInvites={pendingInvites}
        locale={locale}
      />
    </div>
  );
}
