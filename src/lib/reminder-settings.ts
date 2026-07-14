export type ReminderTone = "gentle" | "firm" | "deadline" | "overdue";

export type ReminderTiming = "after_send" | "after_due";

export type ReminderStep = {
  tone: ReminderTone;
  enabled: boolean;
  timing: ReminderTiming;
  days: number;
  repeatCount: number;
  withSms: boolean;
  customSubject: string | null;
  customMessage: string | null;
};

export type ReminderSettings = {
  enabled: boolean;
  steps: ReminderStep[];
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  steps: [
    {
      tone: "gentle",
      enabled: true,
      timing: "after_send",
      days: 3,
      repeatCount: 1,
      withSms: false,
      customSubject: null,
      customMessage: null,
    },
    {
      tone: "firm",
      enabled: true,
      timing: "after_send",
      days: 7,
      repeatCount: 1,
      withSms: true,
      customSubject: null,
      customMessage: null,
    },
    {
      tone: "deadline",
      enabled: true,
      timing: "after_send",
      days: 14,
      repeatCount: 1,
      withSms: true,
      customSubject: null,
      customMessage: null,
    },
    {
      tone: "overdue",
      enabled: true,
      timing: "after_due",
      days: 1,
      repeatCount: 1,
      withSms: false,
      customSubject: null,
      customMessage: null,
    },
  ],
};

const TONES = new Set<ReminderTone>([
  "gentle",
  "firm",
  "deadline",
  "overdue",
]);

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Reminder settings are stored as JSONB and can outlive the code version that
// wrote them. Normalize on every read so a partial/older payload gets the safe
// defaults for missing fields instead of breaking scheduling.
export function normalizeReminderSettings(
  value: unknown,
): ReminderSettings {
  if (!value || typeof value !== "object") {
    return structuredClone(DEFAULT_REMINDER_SETTINGS);
  }

  const raw = value as { enabled?: unknown; steps?: unknown };
  const incoming = Array.isArray(raw.steps) ? raw.steps : [];
  const byTone = new Map<ReminderTone, Record<string, unknown>>();
  for (const candidate of incoming) {
    if (!candidate || typeof candidate !== "object") continue;
    const step = candidate as Record<string, unknown>;
    if (typeof step.tone === "string" && TONES.has(step.tone as ReminderTone)) {
      byTone.set(step.tone as ReminderTone, step);
    }
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    steps: DEFAULT_REMINDER_SETTINGS.steps.map((fallback) => {
      const step = byTone.get(fallback.tone);
      const days = Number(step?.days);
      const repeatCount = Number(step?.repeatCount);
      return {
        ...fallback,
        enabled:
          typeof step?.enabled === "boolean" ? step.enabled : fallback.enabled,
        days: Number.isFinite(days)
          ? Math.min(365, Math.max(1, Math.floor(days)))
          : fallback.days,
        repeatCount: Number.isFinite(repeatCount)
          ? Math.min(12, Math.max(1, Math.floor(repeatCount)))
          : fallback.repeatCount,
        customSubject: optionalText(step?.customSubject, 160),
        customMessage: optionalText(step?.customMessage, 2_000),
      };
    }),
  };
}
