// Google Calendar — the real implementation behind the provider seam.
//
// Read-only, one day at a time, for the SIGNED-IN person's own calendar. Every
// read: find their connection, refresh the access token if it is stale, ask
// Google for that day's window, map the events. No caching layer — the
// dashboard is a server component that re-renders per request, and a cache
// whose staleness nobody can see is worse than one extra HTTPS call.
//
// ── FAILURE IS ALWAYS AN EMPTY DAY, NEVER A BROKEN PAGE ────────────────────
//
// Every path returns [] rather than throwing. The agenda card is one panel on
// the Overview; a calendar outage must not take the firm's task list down with
// it. A DEAD refresh token is the one failure worth remembering, so that flips
// the row to 'error' and the card asks for a reconnect.

import type {
  CalendarConnection,
  CalendarEvent,
  CalendarProvider,
} from "@/lib/calendar/provider";
import { dayWindow, mapGoogleEvent } from "@/lib/calendar/day-window";
import { getCurrentUser } from "@/lib/db/users";
import {
  getMyCalendarConnection,
  markCalendarConnectionError,
  readMyCalendarTokens,
  touchCalendarSync,
  updateCalendarTokens,
} from "@/lib/db/calendar";
import {
  CalendarOauthError,
  isCalendarAccessTokenStale,
  isGoogleCalendarConfigured,
  refreshCalendarTokens,
} from "@/lib/calendar/google/oauth";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";

// A dashboard panel gets one shot at a reasonable latency budget. Past this the
// card renders empty rather than holding the whole page open.
const FETCH_TIMEOUT_MS = 6000;

// The card draws four rows comfortably; asking for more would be paying for
// data nobody sees. Google caps at 2500 anyway.
const MAX_EVENTS = 20;

/**
 * A usable access token for this person, refreshing when stale.
 *
 * Returns null when there is nothing usable — already-marked errors, a dead
 * refresh token (marked here), or an unconfigured deployment.
 */
async function accessTokenFor(userId: string): Promise<string | null> {
  const read = await readMyCalendarTokens(userId);
  if (read.kind !== "ok") return null;
  const { conn } = read;

  if (!isCalendarAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return conn.accessToken;
  }

  try {
    const next = await refreshCalendarTokens(conn.refreshToken);
    // Google usually returns no refresh token on a refresh — keep the one we
    // already have rather than storing null and killing the connection.
    const refreshToken = next.refreshToken ?? conn.refreshToken;
    const wrote = await updateCalendarTokens(userId, conn.refreshToken, {
      accessToken: next.accessToken,
      refreshToken,
      accessTokenExpiresAt: next.accessTokenExpiresAt,
    });
    // "stale" means a concurrent render refreshed first. Its token is just as
    // good as ours and is already stored; use what we just minted for THIS
    // request rather than re-reading.
    if (wrote === "error") return null;
    return next.accessToken;
  } catch (e) {
    if (e instanceof CalendarOauthError && e.dead) {
      // Revoked, expired, or a Testing-mode consent screen past its 7 days.
      // Only a human reconnect fixes this, so record it.
      await markCalendarConnectionError(userId);
      return null;
    }
    console.error("[calendar] refresh failed:", (e as Error).message);
    return null;
  }
}

export const googleCalendar: CalendarProvider = {
  isConfigured(): boolean {
    return isGoogleCalendarConfigured();
  },

  async getConnection(): Promise<CalendarConnection | null> {
    const row = await getMyCalendarConnection();
    if (!row) return null;
    return {
      provider: "google",
      email: row.accountLabel,
      lastSyncedAt: row.lastSyncedAt,
      needsReconnect: row.status === "error",
    };
  },

  async listEventsForDay(
    day: string,
    timeZone: string,
  ): Promise<CalendarEvent[]> {
    if (!isGoogleCalendarConfigured()) return [];
    const me = await getCurrentUser();
    if (!me) return [];

    const token = await accessTokenFor(me.id);
    if (!token) return [];

    const read = await readMyCalendarTokens(me.id);
    const calendarId = read.kind === "ok" ? read.conn.calendarId : "primary";
    const { timeMin, timeMax } = dayWindow(day, timeZone);

    const url = new URL(
      `${EVENTS_URL}/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    // Expand recurring series into their instances — a weekly stand-up must
    // appear on the day it happens, not on the day the series was created.
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(MAX_EVENTS));

    try {
      const res = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        // The token was accepted at refresh but rejected here: the grant is
        // gone (user removed Vylan from their Google account permissions).
        await markCalendarConnectionError(me.id);
        return [];
      }
      if (!res.ok) {
        console.error("[calendar] events.list failed:", res.status);
        return [];
      }
      const json = (await res.json()) as { items?: unknown };
      const items = Array.isArray(json.items) ? json.items : [];
      const events = items
        .map((i) => mapGoogleEvent(i as Parameters<typeof mapGoogleEvent>[0]))
        .filter((e): e is NonNullable<typeof e> => e !== null);

      // Only stamp on a real success — "synced 5 min ago" beside stale data
      // would be a lie the footer tells confidently.
      await touchCalendarSync(me.id);
      return events;
    } catch (e) {
      console.error("[calendar] events.list error:", (e as Error).message);
      return [];
    }
  },
};
