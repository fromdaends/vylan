import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listClients } from "@/lib/db/clients";
import { listRecurringSeries } from "@/lib/db/recurring";
import { buildRepeatingRows } from "@/lib/recurring/list";
import { localToday } from "@/lib/recurring/schedule";
import { hasActiveTeam } from "@/lib/team/mode";
import { RepeatingView } from "@/components/repeating/repeating-view";

export const dynamic = "force-dynamic";

// /repeating — the firm's recurring schedules.
//
// This is the first screen in the product that lists them at all. Until now a
// schedule was invisible infrastructure: it silently manufactured engagements
// every cycle and the only way to see one was to open an engagement it had
// created and click into its Repeat settings. That is precisely how a schedule
// could keep assigning work to someone who left the firm months earlier.
//
// Visible to EVERY member, not owners only. Staff already receive the
// engagements these schedules produce; hiding the machine while showing its
// output is the worse failure. Row-level privacy is enforced in the database
// (recurring_series_select, 0810 + 0950), so a staff member's list is simply
// shorter than an owner's — which is why nothing on this page ever claims to
// be a firm-wide total.
export default async function RepeatingPage({
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

  // One round of queries, joined in memory by buildRepeatingRows — no per-row
  // lookups. includeArchived is required, not incidental: an archived client is
  // exactly what flags a schedule, so excluding them would hide the rows this
  // page exists to surface.
  const [series, clients, members] = await Promise.all([
    listRecurringSeries(),
    listClients({ includeArchived: true }),
    listFirmUsers(),
  ]);

  const rows = buildRepeatingRows({
    series,
    clientsById: new Map(
      clients.map((c) => [
        c.id,
        {
          id: c.id,
          display_name: c.display_name,
          archived_at: c.archived_at,
        },
      ]),
    ),
    usersById: new Map(
      members.map((m) => [
        m.id,
        {
          id: m.id,
          name: userDisplayLabel(m),
          role: m.role,
          deactivated: m.deactivated_at != null,
        },
      ]),
    ),
  });

  const activeMembers = members.filter((m) => m.deactivated_at == null);
  const t = await getTranslations("Repeating");

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h1>
        {/* No "New schedule" button, deliberately: a schedule can only be born
            from an existing engagement's Repeat menu, so a create button here
            would open a flow that doesn't exist. The empty state teaches the
            real path instead. */}
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>

      <RepeatingView
        rows={rows}
        locale={locale}
        // The firm's own calendar day — the same clock the spawner uses, so
        // "in 4 days" can never disagree with when work actually appears.
        today={localToday(firm.timezone)}
        currentUserId={user.id}
        isOwner={user.role === "owner"}
        teamEnabled={hasActiveTeam({
          teamEnabled: firm.team_enabled === true,
          activeMemberCount: activeMembers.length,
        })}
        members={activeMembers.map((m) => ({
          id: m.id,
          name: userDisplayLabel(m),
        }))}
      />
    </div>
  );
}
