// The chase cadence: its bounds, its defaults, and how a schedule is laid out.
//
// NEUTRAL MODULE — same rule as ./filters. The Settings form is a client
// component and needs the bounds to validate against; importing them from
// ./chase would drag the service-role Supabase client and the email sender
// into the browser bundle. Everything here is pure (date-fns is the only
// dependency) so both sides can share it.
//
// ./chase re-exports all of it, so existing import sites are unaffected.

import { addDays } from "date-fns";

// Mirrored from the CHECK constraints in migration 1260, so the form, the
// server action and the database all refuse the same values.
export const CHASE_INTERVAL_MIN = 1;
export const CHASE_INTERVAL_MAX = 60;
export const CHASE_MAX_MIN = 1;
export const CHASE_MAX_MAX = 12;
export const CHASE_INTERVAL_DEFAULT = 7;
export const CHASE_MAX_DEFAULT = 4;

export type ChaseSettings = {
  enabledDefault: boolean;
  intervalDays: number;
  maxReminders: number;
};

export const DEFAULT_CHASE_SETTINGS: ChaseSettings = {
  enabledDefault: true,
  intervalDays: CHASE_INTERVAL_DEFAULT,
  maxReminders: CHASE_MAX_DEFAULT,
};

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Never trust a stored value: a row written before a bound was tightened, or by
// hand, must not be able to queue 400 reminders.
export function normalizeChaseSettings(
  raw: Partial<ChaseSettings> | null | undefined,
): ChaseSettings {
  return {
    enabledDefault: raw?.enabledDefault !== false,
    intervalDays: clamp(
      raw?.intervalDays ?? CHASE_INTERVAL_DEFAULT,
      CHASE_INTERVAL_MIN,
      CHASE_INTERVAL_MAX,
    ),
    maxReminders: clamp(
      raw?.maxReminders ?? CHASE_MAX_DEFAULT,
      CHASE_MAX_MIN,
      CHASE_MAX_MAX,
    ),
  };
}

export type ChasePlanItem = { occurrence: number; runAfter: Date };

// When the reminders for one invoice should go.
//
// The anchor is the due date. An invoice with NO due date is "due on receipt"
// by convention, and chasing it the instant it is issued would be rude, so it
// anchors on the issue date plus one interval — the client gets the same grace
// period a dated invoice's terms would have given them.
export function buildChasePlan(opts: {
  issuedOn: string;
  dueDate: string | null;
  settings: ChaseSettings;
  // Entries already in the past are dropped: a due date set last month must not
  // fire four reminders in the next cron tick.
  now?: Date;
}): ChasePlanItem[] {
  const { settings } = opts;
  const now = opts.now ?? new Date();
  const anchor = opts.dueDate
    ? new Date(`${opts.dueDate}T09:00:00Z`)
    : addDays(new Date(`${opts.issuedOn}T09:00:00Z`), settings.intervalDays);
  if (Number.isNaN(anchor.getTime())) return [];

  const plan: ChasePlanItem[] = [];
  for (let i = 0; i < settings.maxReminders; i++) {
    const runAfter = addDays(anchor, settings.intervalDays * i);
    if (runAfter.getTime() <= now.getTime()) continue;
    plan.push({ occurrence: i + 1, runAfter });
  }
  return plan;
}
