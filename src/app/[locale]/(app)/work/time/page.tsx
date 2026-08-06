// WORK → TIME — the weekly timesheet (timer v2): days as columns, entries
// with client/engagement chips, day and week totals in hours AND dollars
// where the viewer may see them.
//
// HOURS ARE FIRM-SHARED (the standing ruling), so the person switcher is open
// to everyone; DOLLARS come from time_entry_billing, whose RLS answers only
// your own rows or insights.view / rates.manage holders — a staff member
// browsing a colleague's week sees hours and no values, and the totals say
// hours-only rather than summing a partial truth.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser, listActiveFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { listEntriesForWeek } from "@/lib/db/time-entries";
import { listBillableRates, valueCents } from "@/lib/db/time-billing";
import { mondayOf, noonInTimeZone } from "@/lib/time/dates";
import { addDays, dateInTimeZone, todayInTimeZone } from "@/lib/tasks/dates";
import { Timesheet } from "@/components/work/timesheet";

export default async function TimePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ week?: string; person?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user) redirect(`/${locale}/login`);
  if (!firm || !isTimeInsightsEnabled(firm)) redirect(`/${locale}/work`);
  const t = await getTranslations("Time");

  const tz = firm.timezone;
  const today = todayInTimeZone(tz);
  const weekStart = mondayOf(
    /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? (sp.week as string) : today,
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Firm-tz midnight bounds via the noon-minus-12h trick.
  const startNoon = noonInTimeZone(weekStart, tz);
  const endNoon = noonInTimeZone(addDays(weekStart, 7), tz);
  const startIso = startNoon
    ? new Date(startNoon.getTime() - 12 * 3_600_000).toISOString()
    : `${weekStart}T00:00:00Z`;
  const endIso = endNoon
    ? new Date(endNoon.getTime() - 12 * 3_600_000).toISOString()
    : `${addDays(weekStart, 7)}T00:00:00Z`;

  const members = (await listActiveFirmUsers()).map((m) => ({
    id: m.id,
    name: userDisplayLabel(m),
  }));
  const person = members.some((m) => m.id === sp.person)
    ? (sp.person as string)
    : user.id;

  const all = await listEntriesForWeek(startIso, endIso);
  const entries = all.filter((e) => e.user_id === person);
  const rates = await listBillableRates(entries.map((e) => e.id));

  return (
    <Timesheet
      title={t("timesheet_title")}
      days={days}
      weekStart={weekStart}
      prevWeek={addDays(weekStart, -7)}
      nextWeek={addDays(weekStart, 7)}
      person={person}
      members={members}
      currentUserId={user.id}
      canManage={can(user, "time.manage")}
      locale={locale}
      entries={entries.map((e) => {
        const rate = rates.get(e.id);
        return {
          id: e.id,
          userId: e.user_id,
          day: dateInTimeZone(e.started_at, tz) ?? e.started_at.slice(0, 10),
          durationMinutes: e.duration_minutes,
          note: e.note,
          clientId: e.client_id,
          engagementId: e.engagement_id,
          clientName: e.client_name,
          engagementTitle: e.engagement_title,
          valueCents:
            rate == null ? null : valueCents(e.duration_minutes, rate),
        };
      })}
    />
  );
}
