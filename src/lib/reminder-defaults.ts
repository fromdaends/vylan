import {
  normalizeReminderSettings,
  type ReminderSettings,
} from "@/lib/reminder-settings";

export const REMINDER_DEFAULT_FALLBACK_KEY = "default_reminder_settings";

type FirmReminderSource = {
  default_reminder_settings?: unknown;
  business_hours?: Record<string, unknown> | null;
};

// Preview deployments can briefly run against a database where the dedicated
// migration has not landed yet. Read the legacy JSON fallback as well so a
// preset saved during that window remains usable and can be backfilled later.
export function getFirmReminderDefault(
  firm: FirmReminderSource | null | undefined,
): ReminderSettings | null {
  if (!firm) return null;
  const value =
    firm.default_reminder_settings ??
    firm.business_hours?.[REMINDER_DEFAULT_FALLBACK_KEY];
  return value && typeof value === "object"
    ? normalizeReminderSettings(value)
    : null;
}

export function withReminderDefaultFallback(
  businessHours: Record<string, unknown> | null | undefined,
  settings: ReminderSettings | null,
): Record<string, unknown> {
  const next = { ...(businessHours ?? {}) };
  if (settings) next[REMINDER_DEFAULT_FALLBACK_KEY] = settings;
  else delete next[REMINDER_DEFAULT_FALLBACK_KEY];
  return next;
}
