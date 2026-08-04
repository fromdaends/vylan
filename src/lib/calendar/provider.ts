// The agenda card's view of a calendar — deliberately the SMALLEST interface
// that lets the card render (design 2a) without knowing whose calendar it is
// drawing, or which provider it came from.
//
// Google is the only implementation today. When a second one lands (Outlook is
// the obvious next), it implements this and the card does not change — which is
// the entire reason the seam exists.

export type CalendarEvent = {
  id: string;
  /** "Onboarding call — Luna Arcuri" */
  title: string;
  /** ISO datetime. */
  startsAt: string;
  endsAt: string;
  /** Deep link into the provider's UI, when it has one. */
  href?: string;
  /** Whole-day entries render as a label, not a time range. */
  allDay?: boolean;
};

export type CalendarConnection = {
  provider: "google";
  /** The connected account, for the card's footer. */
  email: string | null;
  /** ISO datetime of the last successful read, for "synced 5 min ago". */
  lastSyncedAt: string | null;
  /**
   * True when the link is broken and only a reconnect fixes it (Google revoked
   * the grant, or the consent screen is in Testing mode where refresh tokens
   * expire after seven days). The card says "reconnect", not "connect" —
   * different sentences for different situations.
   */
  needsReconnect: boolean;
};

export interface CalendarProvider {
  /** Null while nothing is connected — the card's empty state. */
  getConnection(): Promise<CalendarConnection | null>;
  /** Events for one calendar day (YYYY-MM-DD) in the given timezone. */
  listEventsForDay(day: string, timeZone: string): Promise<CalendarEvent[]>;
  /** False when the deployment has no Google credentials — the card then says
   *  so plainly instead of offering a button that cannot work. */
  isConfigured(): boolean;
}

import { googleCalendar } from "@/lib/calendar/google";

/** The one place the dashboard asks for a calendar. */
export function getCalendarProvider(): CalendarProvider {
  return googleCalendar;
}
