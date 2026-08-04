// Google Calendar — the stub half of the provider seam (see provider.ts).
//
// No OAuth yet, on purpose: the founder approved the agenda card's design with
// a clean unconnected state, and shipping the card first means the connect flow
// can land later without touching the dashboard again.
//
// When the real integration is built it lives here: a googleapis client fed by
// tokens stored per firm/user (a calendar_connections table), GOOGLE_CLIENT_ID
// and GOOGLE_CLIENT_SECRET env vars, and listEventsForDay calling
// events.list with timeMin/timeMax for the requested day. Until then this
// module answers, truthfully, "nothing is connected".

import type { CalendarProvider } from "@/lib/calendar/provider";

export const googleCalendar: CalendarProvider = {
  async getConnection() {
    return null;
  },
  async listEventsForDay() {
    return [];
  },
};
