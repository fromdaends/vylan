import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";

export const dynamic = "force-dynamic";
import { assertLocale } from "@/lib/locale";
import { listHomeNotifications } from "@/lib/home/notifications";
import { listFirmTasks } from "@/lib/db/engagement-tasks";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { listFirmLinks } from "@/lib/db/firm-links";
import { listClients } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { getCalendarProvider } from "@/lib/calendar/provider";
import { taskStats, todayInTimeZone } from "@/lib/tasks/dates";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { TaskStatsStrip } from "@/components/dashboard/task-stats-strip";
import { AgendaCard } from "@/components/dashboard/agenda-card";
import { QuickLinks } from "@/components/dashboard/quick-links";
import { TasksOverviewCard } from "@/components/dashboard/tasks-overview-card";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { listFeed, unreadCount } from "@/lib/notifications/feed";
import { getServerSupabase } from "@/lib/supabase/server";
import { WhileYouWereAway } from "@/components/dashboard/while-you-were-away";

// The Overview is TASKS-FIRST (design 2a): a greeting, four task counts, the
// day on the left, the work itself on the right. The engagement-centric
// blocks it replaces (template gallery, My engagements, Needs attention) live
// on in their own sections — /engagements answers "where are my jobs", this
// page answers "what do I do next".
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Resolve the viewer first (React.cache'd, so this is ~free) so What's-new
  // can be scoped per-role: staff see their assigned work; owners see firm-wide.
  const user = await getCurrentUser();
  // Redirect-first, like /work: without this, a signed-out request fires every
  // loader below as `anon` in the instant before the layout's redirect wins,
  // which logs scary permission-denied noise that has cost this repo a no-op
  // migration once already.
  if (!user) redirect(`/${locale}/login`);
  const viewer = { userId: user.id, isOwner: user.role === "owner" };

  const calendar = getCalendarProvider();
  const [
    firm,
    members,
    tasks,
    taskStatuses,
    clients,
    engagements,
    links,
    connection,
    notifications,
  ] = await Promise.all([
      getCurrentFirm(),
      listFirmUsers(),
      listFirmTasks(),
      // The firm's own statuses, so a row here wears the same coloured label it
      // wears on the Tasks page. Request-cached, so it is free if anything else
      // on this page already asked.
      listTaskStatuses(),
      // For the quick-add's client picker — the same reason /work loads them.
      listClients(),
      // And the jobs, so the quick-add can start a collection kind too.
      listEngagements(),
      listFirmLinks(),
      calendar.getConnection(),
      // The banner is a nice-to-have glance — never let it crash the whole
      // Overview. On any failure it degrades to empty (and logs for follow-up).
      listHomeNotifications(60, viewer).catch((e) => {
        console.error("[dashboard] home notifications failed:", e);
        return [];
      }),
    ]);

  // The BELL reads the stored notifications table (real read/unread state,
  // deletable). "While you were away" deliberately still reads the DERIVED
  // feed: it is a since-you-last-looked banner keyed off localStorage.
  const supabase = await getServerSupabase();
  const [feedItems, feedUnread] = user
    ? await Promise.all([
        listFeed(supabase, { userId: user.id, limit: 20 }),
        unreadCount(supabase, user.id),
      ])
    : [[], 0];

  // "Today" in the FIRM's timezone, decided once and passed everywhere —
  // the server renders in UTC, where a Quebec evening is already tomorrow.
  const timeZone = firm?.timezone ?? "America/Toronto";
  const today = todayInTimeZone(timeZone);
  const stats = taskStats(tasks, today);
  const events = connection ? await calendar.listEventsForDay(today) : [];

  // First name only — prefer the explicit display_name, fall back to the
  // account name; ignore the email local-part so an unnamed user gets the
  // friendly fallback the greeting renders instead of a raw handle.
  const rawName = user?.display_name?.trim() || user?.name?.trim() || null;
  const firstName = rawName ? (rawName.split(/\s+/)[0] ?? null) : null;

  const activeMembers = members
    .filter((m) => !m.deactivated_at)
    .map((m) => ({ id: m.id, name: userDisplayLabel(m) }));

  // Which built-in kinds each job already has, so the quick-add's picker can
  // grey out the ones the database would refuse (1370) — same map /work builds.
  const kindsByEngagement = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.engagementId || task.kind === "task") continue;
    const list = kindsByEngagement.get(task.engagementId) ?? [];
    list.push(task.kind);
    kindsByEngagement.set(task.engagementId, list);
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Greeting subtitle is the firm name ONLY — the date moved into the
          agenda card, where it is a working surface rather than decoration. */}
      <DashboardHeader
        firstName={firstName}
        subtitle={firm?.name ?? ""}
        bell={
          <NotificationBell
            locale={locale}
            timezone={timeZone}
            initialItems={feedItems}
            initialUnread={feedUnread}
          />
        }
      />

      {/* "While you were away" — a dismissible catch-up of what changed since
          this device last looked. Renders nothing on a first visit or when
          there's nothing new. */}
      <WhileYouWereAway notifications={notifications} locale={locale} />

      {/* Four task counts, each landing on /work pre-filtered to the rows it
          counted. Computed from the same list the card below renders. */}
      <TaskStatsStrip stats={stats} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <AgendaCard
            initialDay={today}
            connection={connection}
            events={events}
          />
          <QuickLinks links={links} />
        </div>

        <TasksOverviewCard
          statuses={taskStatuses}
          tasks={tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            statusId: t.statusId,
            assigneeIds: t.assigneeIds,
            clientId: t.clientId,
            engagementId: t.engagementId,
            clientName: t.clientName,
            engagementTitle: t.engagementTitle,
            dueDate: t.dueDate,
            completedAt: t.completedAt,
          }))}
          members={activeMembers}
          clients={clients.map((c) => ({
            id: c.id,
            display_name: c.display_name,
            type: c.type,
            email: c.email,
          }))}
          engagements={engagements.map((e) => ({
            id: e.id,
            clientId: e.client_id,
            title: e.title,
            existingKinds: kindsByEngagement.get(e.id) ?? [],
          }))}
          viewerId={user?.id ?? ""}
          today={today}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}
