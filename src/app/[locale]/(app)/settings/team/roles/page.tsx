// Roles — its own destination, reached from the firm name's dropdown.
//
// The founder's reference is Discord: Server Settings has a Roles entry in its
// left nav, and opening it gives you a page. Vylan had roles as a block inside
// the firm settings tab, which is the shape you build when roles are decoration
// and the wrong one now they carry permissions.
//
// Owner-only. The settings here decide what everyone wearing a role may do, so
// deciding them cannot be one of the things other people may do.

export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { listFirmRoles, listRolesByUser } from "@/lib/db/firm-roles";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { RolesWorkbench } from "@/components/settings/team/roles-workbench";

export default async function FirmRolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);
  if (!firm.team_enabled) notFound();
  // Not a redirect: a staff member following a link should be told this is not
  // theirs, not silently bounced somewhere else wondering what happened.
  if (!can(user, "team.manage")) notFound();

  const [roles, rolesByUser, members] = await Promise.all([
    listFirmRoles(),
    listRolesByUser(),
    listFirmUsers(),
  ]);

  // Invert "who holds what" into "who is on this role" once, here, rather than
  // making the client do it per tab render.
  const memberIdsByRole = new Map<string, string[]>();
  for (const [userId, held] of rolesByUser) {
    for (const r of held) {
      memberIdsByRole.set(r.id, [...(memberIdsByRole.get(r.id) ?? []), userId]);
    }
  }

  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="max-w-6xl space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: firm.name, href: "/settings/team" },
          { label: t("roles_title") },
        ]}
      />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("roles_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("roles_page_subtitle")}
        </p>
      </header>

      <RolesWorkbench
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          capabilities: r.capabilities,
          memberIds: memberIdsByRole.get(r.id) ?? [],
        }))}
        people={members
          .filter((m) => !m.deactivated_at)
          .map((m) => ({
            id: m.id,
            name: userDisplayLabel(m),
            email: m.email,
          }))}
        selectedId={sp.role ?? null}
      />
    </div>
  );
}
