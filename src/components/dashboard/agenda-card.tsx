"use client";

// Today / agenda card (design 2a) — the day, at a glance, in the left column.
//
// The DATE lives here now, not in the greeting: the header greets, this card
// answers "what is my day". Chevrons page one day at a time client-side.
//
// The calendar itself is behind the provider seam (lib/calendar): nothing is
// connected yet, so the card renders its honest empty state — the date header
// works, the connect line explains, and no dead "Connect" button pretends
// there is a flow that does not exist. When OAuth lands, events replace the
// empty block and this file barely changes.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarConnection, CalendarEvent } from "@/lib/calendar/provider";
import { addDays } from "@/lib/tasks/dates";

// The four token hues the mock rotates through for event dots.
const DOT_CLASSES = [
  "bg-accent",
  "bg-warning",
  "bg-success",
  "bg-icon-purple",
] as const;

export function AgendaCard({
  initialDay,
  connection,
  events,
}: {
  /** Today, YYYY-MM-DD, in the FIRM's timezone — computed on the server. */
  initialDay: string;
  connection: CalendarConnection | null;
  /** Events for initialDay. Paging other days re-renders with what we have —
   *  an unconnected calendar has none anywhere, which is honest. */
  events: CalendarEvent[];
}) {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const [offset, setOffset] = useState(0);
  const day = addDays(initialDay, offset);

  // "MONDAY, AUGUST" over a large "3" — weekday + month up top, day below.
  // Assembled by hand: asking Intl for weekday+month together lets the locale
  // pick the order, and English chose "August Monday" on the real page.
  const d = new Date(`${day}T12:00:00Z`);
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(d);
  const eyebrow = `${part({ weekday: "long" })}, ${part({ month: "long" })}`;
  const dayNumber = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    timeZone: "UTC",
  }).format(d);

  const timeRange = (ev: CalendarEvent) => {
    const fmt = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    const a = new Date(ev.startsAt);
    const b = new Date(ev.endsAt);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
    return `${fmt.format(a)} – ${fmt.format(b)}`;
  };

  // Only today's events are loaded; another day shows the empty rows state.
  const shown = offset === 0 ? events : [];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </p>
          <p className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums">
            {dayNumber}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            aria-label={t("agenda_prev_day")}
            className="flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-[15px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            aria-label={t("agenda_next_day")}
            className="flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-[15px]" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mb-1 mt-4 h-px bg-border/70" />

      {connection && shown.length > 0 ? (
        <div className="flex flex-col">
          {shown.map((ev, i) => (
            <div
              key={ev.id}
              className="flex gap-3 rounded-md px-1 py-3 transition-colors hover:bg-secondary/60"
            >
              <span
                aria-hidden
                className={`mt-1 size-2 flex-none rounded-full ${DOT_CLASSES[i % DOT_CLASSES.length]}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs tabular-nums text-muted-foreground">
                  {timeRange(ev)}
                </p>
                <p className="mt-0.5 truncate text-sm font-medium">{ev.title}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Unconnected (or an empty day): say what this will be, plainly.
        // No dead button — Google sync is stubbed until OAuth exists.
        <div className="flex gap-3 px-1 py-5">
          <CalendarDays
            className="mt-0.5 size-4 flex-none text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {connection ? t("agenda_empty_day") : t("agenda_connect_title")}
            </p>
            {!connection && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {t("agenda_connect_soon")}
              </p>
            )}
          </div>
        </div>
      )}

      {connection && (
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span>{t("agenda_synced", { provider: "Google Calendar" })}</span>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("agenda_open_calendar")}
          </a>
        </div>
      )}
    </div>
  );
}
