// User-facing CRUD for the Notifications settings tab: per-event switches,
// global delivery settings, and the mute list.
//
// Split from src/lib/db/notifications.ts on purpose: that file is the EMITTER's
// path (service role, write-heavy, called from webhooks and jobs). This one runs
// as the SIGNED-IN user through RLS, so a bug here can only ever affect the
// person making the request.
//
// GATED on 0920 like everything else — a missing table degrades to defaults
// rather than throwing, so the settings page renders even if the SQL has not
// been applied yet.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultRecipientSettings,
  isNotificationsSchemaMissing,
} from "./notifications";
import type { RecipientSettings } from "@/lib/notifications/resolve";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/catalog";

export type NotificationPreferenceRow = {
  event_key: string;
  in_app: boolean;
  email: boolean;
};

export type MuteEntityType = "engagement" | "client";

export type MuteRow = {
  entity_type: MuteEntityType;
  entity_id: string;
  created_at: string;
  // Resolved for display; null when the entity has since been deleted.
  label: string | null;
  // Secondary line (the client behind an engagement).
  sublabel: string | null;
};

export type NotificationSettingsBundle = {
  settings: RecipientSettings;
  preferences: NotificationPreferenceRow[];
  mutes: MuteRow[];
  // False when 0920 has not been applied — the UI shows a quiet notice instead
  // of pretending the switches are saving.
  schemaReady: boolean;
};

/**
 * Everything the Notifications tab renders, in one call.
 *
 * Preferences come back as ONLY the rows the user has actually changed. The UI
 * merges them over the catalog defaults, so a default changed in code moves for
 * everyone who never touched that switch — which is the whole point of storing
 * preferences lazily.
 */
export async function loadNotificationSettingsBundle(
  sb: SupabaseClient,
  opts: { userId: string; firmTimezone: string | null },
): Promise<NotificationSettingsBundle> {
  const fallback = defaultRecipientSettings(opts.firmTimezone);

  const [settingsResp, prefsResp, mutesResp] = await Promise.all([
    sb
      .from("notification_settings")
      .select("*")
      .eq("user_id", opts.userId)
      .maybeSingle(),
    sb
      .from("notification_preferences")
      .select("event_key, in_app, email")
      .eq("user_id", opts.userId),
    sb
      .from("notification_mutes")
      .select("entity_type, entity_id, created_at")
      .eq("user_id", opts.userId)
      .order("created_at", { ascending: false }),
  ]);

  if (
    isNotificationsSchemaMissing(settingsResp.error) ||
    isNotificationsSchemaMissing(prefsResp.error) ||
    isNotificationsSchemaMissing(mutesResp.error)
  ) {
    return {
      settings: fallback,
      preferences: [],
      mutes: [],
      schemaReady: false,
    };
  }

  const row = settingsResp.data as Record<string, unknown> | null;
  const settings: RecipientSettings = row
    ? {
        emailEnabled: Boolean(row.email_enabled),
        scope: row.scope === "assigned_only" ? "assigned_only" : "all_firm",
        emailMode:
          row.email_mode === "hourly_digest" || row.email_mode === "daily_digest"
            ? (row.email_mode as "hourly_digest" | "daily_digest")
            : "instant",
        dailyDigestTime:
          typeof row.daily_digest_time === "string"
            ? row.daily_digest_time
            : fallback.dailyDigestTime,
        timezone:
          typeof row.timezone === "string" && row.timezone.trim()
            ? row.timezone
            : fallback.timezone,
        quietHoursEnabled: Boolean(row.quiet_hours_enabled),
        quietHoursStart:
          typeof row.quiet_hours_start === "string"
            ? row.quiet_hours_start
            : fallback.quietHoursStart,
        quietHoursEnd:
          typeof row.quiet_hours_end === "string"
            ? row.quiet_hours_end
            : fallback.quietHoursEnd,
        pauseWeekends: Boolean(row.pause_weekends),
        emailDetailLevel:
          row.email_detail_level === "minimal" ? "minimal" : "full",
      }
    : fallback;

  const rawMutes = (mutesResp.data ?? []) as {
    entity_type: string;
    entity_id: string;
    created_at: string;
  }[];

  return {
    settings,
    preferences: (prefsResp.data ?? []) as NotificationPreferenceRow[],
    mutes: await resolveMuteLabels(sb, rawMutes),
    schemaReady: true,
  };
}

// Turn bare (type, id) mutes into something a human can recognise in a list.
// Two batched queries, never one per row. A mute whose entity has since been
// deleted keeps a null label — the UI shows a generic row with an unmute button
// rather than hiding it, so the user can always clear it.
async function resolveMuteLabels(
  sb: SupabaseClient,
  rows: { entity_type: string; entity_id: string; created_at: string }[],
): Promise<MuteRow[]> {
  if (rows.length === 0) return [];
  const engagementIds = rows
    .filter((r) => r.entity_type === "engagement")
    .map((r) => r.entity_id);
  const clientIds = rows
    .filter((r) => r.entity_type === "client")
    .map((r) => r.entity_id);

  const [engResp, clientResp] = await Promise.all([
    engagementIds.length
      ? sb
          .from("engagements")
          .select("id, title, client_id")
          .in("id", engagementIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? sb.from("clients").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const engagements = new Map(
    ((engResp.data ?? []) as { id: string; title: string; client_id: string }[]).map(
      (e) => [e.id, e],
    ),
  );
  const clients = new Map(
    ((clientResp.data ?? []) as { id: string; display_name: string }[]).map(
      (c) => [c.id, c.display_name],
    ),
  );

  // An engagement's sublabel is its client's name — fetch any we didn't already
  // pull for a direct client mute.
  const extraClientIds = Array.from(engagements.values())
    .map((e) => e.client_id)
    .filter((id) => id && !clients.has(id));
  if (extraClientIds.length > 0) {
    const { data } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", extraClientIds);
    for (const c of (data ?? []) as { id: string; display_name: string }[]) {
      clients.set(c.id, c.display_name);
    }
  }

  return rows.map((r) => {
    if (r.entity_type === "engagement") {
      const e = engagements.get(r.entity_id);
      return {
        entity_type: "engagement" as const,
        entity_id: r.entity_id,
        created_at: r.created_at,
        label: e?.title ?? null,
        sublabel: e ? (clients.get(e.client_id) ?? null) : null,
      };
    }
    return {
      entity_type: "client" as const,
      entity_id: r.entity_id,
      created_at: r.created_at,
      label: clients.get(r.entity_id) ?? null,
      sublabel: null,
    };
  });
}

export type NotificationSettingsPatch = {
  emailEnabled: boolean;
  scope: "assigned_only" | "all_firm";
  emailMode: "instant" | "hourly_digest" | "daily_digest";
  dailyDigestTime: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  pauseWeekends: boolean;
  emailDetailLevel: "full" | "minimal";
};

export async function saveNotificationSettings(
  sb: SupabaseClient,
  opts: {
    userId: string;
    firmId: string;
    patch: NotificationSettingsPatch;
  },
): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await sb.from("notification_settings").upsert(
    {
      user_id: opts.userId,
      firm_id: opts.firmId,
      email_enabled: opts.patch.emailEnabled,
      scope: opts.patch.scope,
      email_mode: opts.patch.emailMode,
      daily_digest_time: opts.patch.dailyDigestTime,
      timezone: opts.patch.timezone,
      quiet_hours_enabled: opts.patch.quietHoursEnabled,
      quiet_hours_start: opts.patch.quietHoursStart,
      quiet_hours_end: opts.patch.quietHoursEnd,
      pause_weekends: opts.patch.pauseWeekends,
      email_detail_level: opts.patch.emailDetailLevel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    if (isNotificationsSchemaMissing(error)) {
      return { ok: false, reason: "schema_missing" };
    }
    console.error("[notification-settings] save:", error);
    return { ok: false, reason: "save_failed" };
  }
  return { ok: true };
}

/**
 * Replace this user's per-event preferences.
 *
 * Rows that match the catalog default are DELETED rather than stored, which
 * keeps the lazy-row model honest: storing a row that merely restates the
 * default would freeze that user at today's default forever, so a later product
 * decision to change it would silently skip everyone who had ever opened this
 * page and pressed Save.
 *
 * Events the catalog marks can_disable:false are ignored entirely — they cannot
 * be changed, so accepting a row for one would just be a lie in the database.
 */
export async function saveNotificationPreferences(
  sb: SupabaseClient,
  opts: {
    userId: string;
    firmId: string;
    prefs: { eventKey: string; inApp: boolean; email: boolean }[];
  },
): Promise<{ ok: boolean; reason?: string }> {
  const catalog = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

  const toUpsert: {
    user_id: string;
    firm_id: string;
    event_key: string;
    in_app: boolean;
    email: boolean;
    updated_at: string;
  }[] = [];
  const toDelete: string[] = [];

  for (const p of opts.prefs) {
    const event = catalog.get(p.eventKey);
    if (!event || !event.canDisable) continue;
    const isDefault =
      p.inApp === event.defaultInApp && p.email === event.defaultEmail;
    if (isDefault) {
      toDelete.push(p.eventKey);
    } else {
      toUpsert.push({
        user_id: opts.userId,
        firm_id: opts.firmId,
        event_key: p.eventKey,
        in_app: p.inApp,
        email: p.email,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await sb
      .from("notification_preferences")
      .upsert(toUpsert, { onConflict: "user_id,event_key" });
    if (error) {
      if (isNotificationsSchemaMissing(error)) {
        return { ok: false, reason: "schema_missing" };
      }
      console.error("[notification-settings] savePrefs upsert:", error);
      return { ok: false, reason: "save_failed" };
    }
  }

  if (toDelete.length > 0) {
    const { error } = await sb
      .from("notification_preferences")
      .delete()
      .eq("user_id", opts.userId)
      .in("event_key", toDelete);
    if (error && !isNotificationsSchemaMissing(error)) {
      console.error("[notification-settings] savePrefs delete:", error);
      return { ok: false, reason: "save_failed" };
    }
  }

  return { ok: true };
}

export async function addNotificationMute(
  sb: SupabaseClient,
  opts: {
    userId: string;
    firmId: string;
    entityType: MuteEntityType;
    entityId: string;
  },
): Promise<boolean> {
  const { error } = await sb.from("notification_mutes").upsert(
    {
      user_id: opts.userId,
      firm_id: opts.firmId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
    },
    { onConflict: "user_id,entity_type,entity_id" },
  );
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notification-settings] addMute:", error);
    }
    return false;
  }
  return true;
}

export async function removeNotificationMute(
  sb: SupabaseClient,
  opts: { userId: string; entityType: MuteEntityType; entityId: string },
): Promise<boolean> {
  const { error } = await sb
    .from("notification_mutes")
    .delete()
    .eq("user_id", opts.userId)
    .eq("entity_type", opts.entityType)
    .eq("entity_id", opts.entityId);
  if (error) {
    if (!isNotificationsSchemaMissing(error)) {
      console.error("[notification-settings] removeMute:", error);
    }
    return false;
  }
  return true;
}
