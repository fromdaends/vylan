import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getRunningEntry,
  listEntriesForWeek,
} from "@/lib/db/time-entries";
import { localDay, noonInTimeZone } from "@/lib/time/dates";
import {
  addDays,
  daysForView,
  type TimeCard,
  type TimeView,
} from "@/lib/time/time-page";
import { TimePageView } from "@/components/time/page/time-page-view";

export const dynamic = "force-dynamic";

// /time — where your week went.
//
// The range is decided HERE, on the server, from the view and the anchor in the
// URL. That keeps the page shareable and the back button meaningful, and it
// means the fetch asks for exactly the days being drawn rather than a fixed
// week the month view would then have to fill in around.

export default async function TimePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  const tz = firm?.timezone ?? "America/Toronto";
  const today = localDay();

  const view: TimeView =
    sp.view === "day" || sp.view === "month" ? sp.view : "week";
  // A malformed ?date must not throw the page — it falls back to today.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

  const days = daysForView(view, anchor);
  const first = days[0];
  const lastExclusive = addDays(days[days.length - 1], 1);
  const startIso = noonInTimeZone(first, tz);
  const endIso = noonInTimeZone(lastExclusive, tz);

  const [entries, running] = await Promise.all([
    startIso && endIso
      ? listEntriesForWeek(
          // Noon-anchored bounds shifted back half a day, so an entry logged at
          // 8am on the first day is inside the range. The helper only knows how
          // to give us noon; the range wants midnight.
          new Date(startIso.getTime() - 12 * 3600_000).toISOString(),
          new Date(endIso.getTime() - 12 * 3600_000).toISOString(),
          user?.id,
        )
      : Promise.resolve([]),
    user ? getRunningEntry(user.id) : Promise.resolve(null),
  ]);

  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));

  const minuteOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  };

  const cards: TimeCard[] = entries.map((e) => ({
    id: e.id,
    day: dayOf(e.started_at),
    clientName: e.client_name,
    // The engagement names the work; the note is the fallback for time logged
    // against a client with no engagement.
    task: e.engagement_title ?? e.note,
    minutes: e.duration_minutes,
    startMinute: minuteOf(e.started_at),
    running: false,
  }));

  if (running) {
    cards.push({
      id: running.id,
      day: dayOf(running.started_at),
      clientName: running.client_name,
      task: running.engagement_title ?? running.note,
      // Whatever has already been banked; the page adds the live seconds.
      minutes: running.duration_minutes,
      startMinute: minuteOf(running.started_at),
      running: true,
      startedAtIso: running.started_at,
    });
  }

  return (
    <div className="px-6 pt-7 pb-16 lg:px-8">
      <TimePageView
        cards={cards}
        anchor={anchor}
        view={view}
        today={today}
        locale={locale}
        personName={user?.display_name ?? user?.name ?? user?.email ?? ""}
      />
    </div>
  );
}
