// Notifications data access (migration 0920).
//
// GATED on 0920, following the same rule as team chat (0870) and client
// messages (0650): every reader and writer treats a missing table/column as
// "not activated yet" and degrades to a no-op instead of throwing. Dev and prod
// both run against remote Supabase, and the migration is applied by hand BEFORE
// its PR merges — but the gate means neither ordering can take the app down, and
// an emitter call can never break the business action that triggered it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RecipientCandidate,
  RecipientSettings,
} from "@/lib/notifications/resolve";

export const NOTIFICATIONS_SCHEMA_MISSING = Symbol(
  "notifications-schema-missing",
);
export type NotificationsSchemaMissing = typeof NOTIFICATIONS_SCHEMA_MISSING;

// Missing TABLE (PGRST205 / 42P01) or COLUMN (PGRST204 / 42703). Codes ONLY,
// never message text (repo rule).
export function isNotificationsSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

export type NotificationRow = {
  id: string;
  firm_id: string;
  user_id: string;
  event_key: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  dismissed_at: string | null;
  email_sent_at: string | null;
  created_at: string;
};

// Fallback when a user has never saved anything. `timezone` is threaded in from
// firms.timezone by the caller — a column DEFAULT cannot read another table, so
// the firm's own zone is applied here rather than hardcoding Eastern for a firm
// that isn't in it.
export function defaultRecipientSettings(
  firmTimezone: string | null | undefined,
): RecipientSettings {
  return {
    emailEnabled: true,
    scope: "all_firm",
    emailMode: "instant",
    dailyDigestTime: "08:00",
    timezone: firmTimezone?.trim() || "America/Toronto",
    quietHoursEnabled: false,
    quietHoursStart: "20:00",
    quietHoursEnd: "07:00",
    pauseWeekends: false,
    emailDetailLevel: "full",
  };
}

type SettingsRow = {
  user_id: string;
  email_enabled: boolean;
  scope: string;
  email_mode: string;
  daily_digest_time: string;
  timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  pause_weekends: boolean;
  email_detail_level: string;
};

function toRecipientSettings(
  row: SettingsRow | undefined,
  firmTimezone: string | null | undefined,
): RecipientSettings {
  const base = defaultRecipientSettings(firmTimezone);
  if (!row) return base;
  return {
    emailEnabled: row.email_enabled,
    scope: row.scope === "assigned_only" ? "assigned_only" : "all_firm",
    emailMode:
      row.email_mode === "hourly_digest" || row.email_mode === "daily_digest"
        ? row.email_mode
        : "instant",
    dailyDigestTime: row.daily_digest_time || base.dailyDigestTime,
    timezone: row.timezone?.trim() || base.timezone,
    quietHoursEnabled: row.quiet_hours_enabled,
    quietHoursStart: row.quiet_hours_start || base.quietHoursStart,
    quietHoursEnd: row.quiet_hours_end || base.quietHoursEnd,
    pauseWeekends: row.pause_weekends,
    emailDetailLevel: row.email_detail_level === "minimal" ? "minimal" : "full",
  };
}

/**
 * Every candidate recipient in a firm, with the settings, per-event preference
 * and mute list the resolver needs. One pass, four queries, no N+1.
 *
 * Deactivated teammates are excluded here rather than in the resolver: they are
 * not recipients at all, they are not people who chose to opt out.
 */
export async function loadFirmRecipients(
  sb: SupabaseClient,
  opts: { firmId: string; eventKey: string; firmTimezone?: string | null },
): Promise<RecipientCandidate[] | NotificationsSchemaMissing> {
  const { data: users, error: usersErr } = await sb
    .from("users")
    .select("id, role, locale, email, deactivated_at")
    .eq("firm_id", opts.firmId);
  if (usersErr) {
    // The users table always exists — a failure here is a real error, but it
    // must not blow up the caller's business action.
    console.error("[notifications] loadFirmRecipients users:", usersErr);
    return [];
  }
  const active = (users ?? []).filter(
    (u) => !(u as { deactivated_at: string | null }).deactivated_at,
  );
  if (active.length === 0) return [];
  const userIds = active.map((u) => u.id as string);

  const [settingsResp, prefsResp, mutesResp] = await Promise.all([
    sb.from("notification_settings").select("*").in("user_id", userIds),
    sb
      .from("notification_preferences")
      .select("user_id, in_app, email")
      .in("user_id", userIds)
      .eq("event_key", opts.eventKey),
    sb
      .from("notification_mutes")
      .select("user_id, entity_type, entity_id")
      .in("user_id", userIds),
  ]);

  if (
    isNotificationsSchemaMissing(settingsResp.error) ||
    isNotificationsSchemaMissing(prefsResp.error) ||
    isNotificationsSchemaMissing(mutesResp.error)
  ) {
    return NOTIFICATIONS_SCHEMA_MISSING;
  }

  const settingsByUser = new Map<string, SettingsRow>(
    ((settingsResp.data ?? []) as SettingsRow[]).map((r) => [r.user_id, r]),
  );
  const prefByUser = new Map<string, { inApp: boolean; email: boolean }>(
    ((prefsResp.data ?? []) as { user_id: string; in_app: boolean; email: boolean }[]).map(
      (r) => [r.user_id, { inApp: r.in_app, email: r.email }],
    ),
  );
  const mutesByUser = new Map<string, Set<string>>();
  for (const m of (mutesResp.data ?? []) as {
    user_id: string;
    entity_type: string;
    entity_id: string;
  }[]) {
    const set = mutesByUser.get(m.user_id) ?? new Set<string>();
    set.add(`${m.entity_type}:${m.entity_id}`);
    mutesByUser.set(m.user_id, set);
  }

  return active.map((u) => {
    const row = u as {
      id: string;
      role: string;
      locale: string;
      email: string | null;
    };
    return {
      userId: row.id,
      role: row.role === "owner" ? "owner" : "staff",
      locale: row.locale === "en" ? "en" : "fr",
      email: row.email,
      settings: toRecipientSettings(
        settingsByUser.get(row.id),
        opts.firmTimezone,
      ),
      pref: prefByUser.get(row.id) ?? null,
      mutes: mutesByUser.get(row.id) ?? new Set<string>(),
    } satisfies RecipientCandidate;
  });
}

/**
 * Rule 6 — bundling. Find this user's existing LIVE row for the same
 * (event, entity): unread, not dismissed, and inside the bundle window.
 *
 * Reading only unread + undismissed rows is what makes "a client dumping 14
 * receipts produces one notification" work without also silently swallowing an
 * event the user has already seen and acted on.
 */
export async function findBundleTarget(
  sb: SupabaseClient,
  opts: {
    userId: string;
    eventKey: string;
    entityId: string | null;
    since: Date;
  },
): Promise<NotificationRow | null> {
  let query = sb
    .from("notifications")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("event_key", opts.eventKey)
    .is("read_at", null)
    .is("dismissed_at", null)
    .gte("created_at", opts.since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  query = opts.entityId
    ? query.eq("entity_id", opts.entityId)
    : query.is("entity_id", null);

  const { data, error } = await query;
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] findBundleTarget:", error);
    }
    return null;
  }
  return ((data ?? [])[0] as NotificationRow | undefined) ?? null;
}

export type NotificationInsert = {
  firm_id: string;
  user_id: string;
  event_key: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
};

export async function insertNotifications(
  sb: SupabaseClient,
  rows: NotificationInsert[],
): Promise<NotificationRow[] | NotificationsSchemaMissing> {
  if (rows.length === 0) return [];
  const { data, error } = await sb.from("notifications").insert(rows).select("*");
  if (error) {
    if (isNotificationsSchemaMissing(error)) return NOTIFICATIONS_SCHEMA_MISSING;
    console.error("[notifications] insertNotifications:", error);
    return [];
  }
  return (data ?? []) as NotificationRow[];
}

/**
 * Fold a repeat occurrence into an existing row: merge the payload and move
 * created_at forward so it resurfaces at the top of the feed. payload.first_at
 * preserves when the bundle actually started.
 */
export async function bumpNotification(
  sb: SupabaseClient,
  opts: { id: string; payload: Record<string, unknown>; at: Date },
): Promise<NotificationRow | null> {
  const { data, error } = await sb
    .from("notifications")
    .update({ payload: opts.payload, created_at: opts.at.toISOString() })
    .eq("id", opts.id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] bumpNotification:", error);
    }
    return null;
  }
  return (data as NotificationRow | null) ?? null;
}

export async function markNotificationEmailSent(
  sb: SupabaseClient,
  ids: string[],
  at: Date,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await sb
    .from("notifications")
    .update({ email_sent_at: at.toISOString() })
    .in("id", ids);
  if (error && !isNotificationsSchemaMissing(error)) {
    console.error("[notifications] markNotificationEmailSent:", error);
  }
}

// ── Feed reads (used by the bell, /notifications, and the digest builder) ────

export async function listUserNotifications(
  sb: SupabaseClient,
  opts: {
    userId: string;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  },
): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  let query = sb
    .from("notifications")
    .select("*")
    .eq("user_id", opts.userId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] listUserNotifications:", error);
    }
    return [];
  }
  return (data ?? []) as NotificationRow[];
}

export async function countUnreadNotifications(
  sb: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .is("dismissed_at", null);
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] countUnreadNotifications:", error);
    }
    return 0;
  }
  return count ?? 0;
}

// ── Feed writes (the interactive bell: read / unread / delete) ───────────────
//
// All of these run as the SIGNED-IN user, not the service role: RLS restricts
// them to their own rows, and the column grant restricts them to read_at and
// dismissed_at, so a forged request cannot rewrite a notification's contents.

export async function setNotificationRead(
  sb: SupabaseClient,
  opts: { id: string; read: boolean },
): Promise<boolean> {
  const { error } = await sb
    .from("notifications")
    .update({ read_at: opts.read ? new Date().toISOString() : null })
    .eq("id", opts.id);
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] setNotificationRead:", error);
    }
    return false;
  }
  return true;
}

export async function markAllNotificationsRead(
  sb: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .is("dismissed_at", null);
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] markAllNotificationsRead:", error);
    }
    return false;
  }
  return true;
}

// The founder's "delete". Soft — see the migration comment on dismissed_at.
export async function dismissNotification(
  sb: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { error } = await sb
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notifications] dismissNotification:", error);
    }
    return false;
  }
  return true;
}
