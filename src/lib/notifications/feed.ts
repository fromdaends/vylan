// The notification feed, read from the stored `notifications` table.
//
// This is the seam src/lib/home/notifications.ts always described in its
// TODO(notifications-table): the bell, the /notifications page and the
// "while you were away" banner all read from HERE now, so read state, deletion
// and per-user preferences are real rather than recomputed on every page load.
//
// One consequence worth stating plainly: the old feed DERIVED itself from the
// activity log, so it could show the last 14 days the moment it shipped. A
// stored feed can only show what has happened since the emitter went live, so
// it starts empty and fills in as the firm works. That is the price of having
// read/unread state at all — there is no honest way to backfill "unread" for
// events nobody was ever shown.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countUnreadNotifications,
  listUserNotifications,
  type NotificationRow,
} from "@/lib/db/notifications";
import { getNotificationEvent, labelKeyFor } from "./catalog";
import { hrefFor } from "./email";

export type FeedItem = {
  id: string;
  eventKey: string;
  // i18n key in the Notifications namespace.
  labelKey: string;
  category: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  // Context line under the label. Already resolved from the payload.
  clientName: string | null;
  engagementTitle: string | null;
  actorName: string | null;
  // Bundled occurrences ("3 documents"), 1 when it is a single event.
  count: number;
  note: string | null;
};

export function toFeedItem(row: NotificationRow): FeedItem | null {
  const event = getNotificationEvent(row.event_key);
  // A row whose event has since been retired from the catalog would render as a
  // blank line with a raw key. Drop it instead.
  if (!event) return null;
  const p = row.payload ?? {};
  const str = (k: string): string | null => {
    const v = p[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const rawCount = p.count;
  return {
    id: row.id,
    eventKey: row.event_key,
    labelKey: labelKeyFor(row.event_key),
    category: event.category,
    href: hrefFor(row),
    createdAt: row.created_at,
    readAt: row.read_at,
    clientName: str("client_name"),
    engagementTitle: str("engagement_title"),
    actorName: str("actor_name"),
    count:
      typeof rawCount === "number" && rawCount > 1 ? Math.floor(rawCount) : 1,
    note: str("note"),
  };
}

export async function listFeed(
  sb: SupabaseClient,
  opts: {
    userId: string;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  },
): Promise<FeedItem[]> {
  const rows = await listUserNotifications(sb, opts);
  return rows
    .filter(showsInFeed)
    .map(toFeedItem)
    .filter((x): x is FeedItem => x !== null);
}

/**
 * Should this row appear in the feed at all?
 *
 * A user who switches In-app OFF but leaves Email ON still needs a row — the
 * email is queued against it. Without this filter that row would show up in
 * the bell anyway and the In-app switch would be decorative. notify() stamps
 * `in_app` on the payload at insert time, where the preference is in scope.
 *
 * Absent (rows written before this flag existed) means show it: an old
 * notification quietly vanishing is worse than one extra row.
 */
export function showsInFeed(row: NotificationRow): boolean {
  return (row.payload ?? {}).in_app !== false;
}

export async function unreadCount(
  sb: SupabaseClient,
  userId: string,
): Promise<number> {
  return countUnreadNotifications(sb, userId);
}

// Group a feed into day buckets for the popover and the full page. Returns ISO
// dates (YYYY-MM-DD) in the VIEWER's timezone so "Today" means their today, not
// UTC's — a notification at 21:00 Eastern is 01:00 UTC the next day, and
// bucketing on the raw ISO string would file it under tomorrow.
export function groupByDay(
  items: FeedItem[],
  timeZone: string,
): { day: string; items: FeedItem[] }[] {
  const out: { day: string; items: FeedItem[] }[] = [];
  const index = new Map<string, FeedItem[]>();
  for (const item of items) {
    const day = localDayKey(item.createdAt, timeZone);
    const bucket = index.get(day);
    if (bucket) {
      bucket.push(item);
    } else {
      const fresh = [item];
      index.set(day, fresh);
      out.push({ day, items: fresh });
    }
  }
  return out;
}

export function localDayKey(iso: string, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
