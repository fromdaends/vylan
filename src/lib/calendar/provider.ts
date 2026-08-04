// The agenda card's view of a calendar — deliberately the SMALLEST interface
// that lets the card render today (design 2a) without knowing whose calendar
// it is drawing.
//
// Google is the assumed first provider and is a STUB: no OAuth flow exists yet,
// so getCalendarConnection() answers null and the card shows its "connect your
// calendar" state. When the real integration lands it replaces google.ts and
// nothing that renders the card changes — that is the whole point of the seam.

export type CalendarEvent = {
  id: string;
  /** "Onboarding call — Luna Arcuri" */
  title: string;
  /** ISO datetime, in the calendar's own timezone. */
  startsAt: string;
  endsAt: string;
  /** Deep link into the provider's UI, when it has one. */
  href?: string;
};

export type CalendarConnection = {
  provider: "google";
  /** The connected account, for the card's footer line. */
  email: string | null;
  /** ISO datetime of the last sync, for "synced 5 min ago". */
  lastSyncedAt: string | null;
};

export interface CalendarProvider {
  /** Null while nothing is connected — the card's empty state. */
  getConnection(): Promise<CalendarConnection | null>;
  /** Events for one calendar day (YYYY-MM-DD in the firm's timezone). */
  listEventsForDay(day: string): Promise<CalendarEvent[]>;
}

import { googleCalendar } from "@/lib/calendar/google";

/** The one place the dashboard asks for a calendar. */
export function getCalendarProvider(): CalendarProvider {
  return googleCalendar;
}
