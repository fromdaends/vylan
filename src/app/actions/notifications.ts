"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import {
  removeNotificationMute,
  saveNotificationPreferences,
  saveNotificationSettings,
  addNotificationMute,
} from "@/lib/db/notification-settings";
import {
  dismissNotification,
  markAllNotificationsRead,
  setNotificationRead,
} from "@/lib/db/notifications";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/catalog";

export type NotificationActionResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "invalid" | "save_failed" | "schema_missing" };

// Every write here runs as the SIGNED-IN user, so RLS is the real boundary:
// even a forged event key or notification id can only ever touch that user's
// own rows. The validation below is about keeping bad data out of our own
// tables, not about access control.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const SettingsSchema = z.object({
  emailEnabled: z.boolean(),
  scope: z.enum(["assigned_only", "all_firm"]),
  emailMode: z.enum(["instant", "hourly_digest", "daily_digest"]),
  dailyDigestTime: z.string().regex(TIME_RE),
  // Not a free string: an arbitrary value here would be silently swallowed by
  // Intl's fallback and quietly deliver everything in the wrong timezone.
  timezone: z.string().min(1).max(64),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(TIME_RE),
  quietHoursEnd: z.string().regex(TIME_RE),
  pauseWeekends: z.boolean(),
  emailDetailLevel: z.enum(["full", "minimal"]),
});

const PrefsSchema = z.array(
  z.object({
    eventKey: z.string().min(1).max(64),
    inApp: z.boolean(),
    email: z.boolean(),
  }),
);

const SaveSchema = z.object({
  settings: SettingsSchema,
  preferences: PrefsSchema,
});

// Timezones the UI offers. Mirrors the CA_TIMEZONES list in settings-form and
// the server-side allow-list in /api/firm/timezone — an unknown zone is
// rejected rather than stored, because Intl would fall back silently and the
// user would never learn their quiet hours were being judged in the wrong zone.
const ALLOWED_TIMEZONES = new Set([
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Edmonton",
  "America/Vancouver",
]);

export async function saveNotificationSettingsAction(
  input: unknown,
): Promise<NotificationActionResult> {
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!ALLOWED_TIMEZONES.has(parsed.data.settings.timezone)) {
    return { ok: false, error: "invalid" };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  // Staff must not be able to set preferences for owner-only events, even by
  // posting the key directly — the UI hides them, and this is the enforcement.
  const ownerOnly = new Set(
    NOTIFICATION_EVENTS.filter((e) => e.ownerOnly).map((e) => e.key),
  );
  const prefs =
    user.role === "owner"
      ? parsed.data.preferences
      : parsed.data.preferences.filter((p) => !ownerOnly.has(p.eventKey));

  const sb = await getServerSupabase();
  const settingsResult = await saveNotificationSettings(sb, {
    userId: user.id,
    firmId: user.firm_id,
    patch: parsed.data.settings,
  });
  if (!settingsResult.ok) {
    return {
      ok: false,
      error: settingsResult.reason === "schema_missing" ? "schema_missing" : "save_failed",
    };
  }

  const prefsResult = await saveNotificationPreferences(sb, {
    userId: user.id,
    firmId: user.firm_id,
    prefs,
  });
  if (!prefsResult.ok) {
    return {
      ok: false,
      error: prefsResult.reason === "schema_missing" ? "schema_missing" : "save_failed",
    };
  }

  revalidatePath("/settings");
  return { ok: true };
}

const MuteSchema = z.object({
  entityType: z.enum(["engagement", "client"]),
  entityId: z.string().uuid(),
});

export async function muteEntityAction(
  input: unknown,
): Promise<NotificationActionResult> {
  const parsed = MuteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  const sb = await getServerSupabase();
  const ok = await addNotificationMute(sb, {
    userId: user.id,
    firmId: user.firm_id,
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
  });
  if (!ok) return { ok: false, error: "save_failed" };
  revalidatePath("/settings");
  return { ok: true };
}

export async function unmuteEntityAction(
  input: unknown,
): Promise<NotificationActionResult> {
  const parsed = MuteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  const sb = await getServerSupabase();
  const ok = await removeNotificationMute(sb, {
    userId: user.id,
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
  });
  if (!ok) return { ok: false, error: "save_failed" };
  revalidatePath("/settings");
  return { ok: true };
}

// ── The interactive feed: read / unread / delete ────────────────────────────

const IdSchema = z.object({ id: z.string().uuid() });

export async function setNotificationReadAction(
  input: unknown,
): Promise<NotificationActionResult> {
  const parsed = z
    .object({ id: z.string().uuid(), read: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  const sb = await getServerSupabase();
  const ok = await setNotificationRead(sb, {
    id: parsed.data.id,
    read: parsed.data.read,
  });
  if (!ok) return { ok: false, error: "save_failed" };
  // The bell badge and the feed page both read this count.
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function dismissNotificationAction(
  input: unknown,
): Promise<NotificationActionResult> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  const sb = await getServerSupabase();
  const ok = await dismissNotification(sb, parsed.data.id);
  if (!ok) return { ok: false, error: "save_failed" };
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauth" };

  const sb = await getServerSupabase();
  const ok = await markAllNotificationsRead(sb, user.id);
  if (!ok) return { ok: false, error: "save_failed" };
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}
