"use server";

// Time tracking — start, stop, log, fix, remove.
//
// WHO MAY DO WHAT is decided by RLS (1750), not here. The checks in this file
// exist to fail fast with a sayable reason; every one of them is duplicated,
// harder, in the database. The founder's rule shapes them all: roles only —
// your own entries need no capability, a teammate's need time.manage, and no
// check anywhere asks whether you are an owner.
//
// THE SNAPSHOT: an entry created by someone whose cost rate is set gets that
// rate frozen into time_entry_costs — over the author's head, via the service
// role, because the author's own session deliberately cannot read the rates
// table. A missing rate writes NOTHING: unknown cost must never be stored as
// free (the insights banner counts those hours instead).
//
// NO INVOICE PATH. Nothing in this file touches payment_requests, and nothing
// may: time is internal costing intelligence, clients are billed flat.
//
// This file exports async functions ONLY (a sync export in a "use server"
// module fails the production build naming something unrelated).

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { noonInTimeZone } from "@/lib/time/dates";
import {
  getRunningEntry,
  insertTimerStart,
  insertManualEntry,
  stopEntry,
  updateEntry,
  softDeleteEntry,
  TimeEntriesUnsupportedError,
  type TimeEntry,
} from "@/lib/db/time-entries";
import {
  getCostRateForUserSR,
  writeCostSnapshotSR,
} from "@/lib/db/user-rates";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; error: "not_enabled" | "not_signed_in" | "not_allowed" | "invalid" | "unsupported" | "failed" };

// A day of deep work is long; a WEEK in one entry is a typo (the "90" that
// meant minutes, parsed as hours). Manual entries are capped at 24h — the
// timer is not, because a timer left running overnight is an honest duration
// the owner of the entry can shorten afterwards.
const MANUAL_MAX_MINUTES = 24 * 60;

function revalidateTime(
  engagementId?: string | null,
  clientId?: string | null,
) {
  if (engagementId) revalidateAllLocales(`/engagements/${engagementId}`);
  if (clientId) revalidateAllLocales(`/clients/${clientId}`);
}

async function guard(): Promise<
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; firm: NonNullable<Awaited<ReturnType<typeof getCurrentFirm>>> }
  | { ok: false; error: "not_enabled" | "not_signed_in" }
> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "not_signed_in" };
  if (!isTimeInsightsEnabled(firm)) return { ok: false, error: "not_enabled" };
  return { ok: true, user, firm };
}

async function snapshotCost(entry: TimeEntry): Promise<void> {
  const rate = await getCostRateForUserSR(entry.user_id, entry.firm_id);
  if (rate != null) {
    await writeCostSnapshotSR(entry.id, entry.firm_id, rate);
  }
}

/** Start a timer. Any running timer is stopped and SAVED first — switching
 *  work is one click, and no minute is lost to it. */
export async function startTimerAction(input: {
  clientId: string;
  engagementId?: string | null;
  taskId?: string | null;
}): Promise<Result<{ id: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const { user, firm } = g;
  if (!input.clientId) return { ok: false, error: "invalid" };

  try {
    // Stop the current timer, if any. Its note stays as typed.
    const running = await getRunningEntry(user.id);
    if (running) {
      await stopEntry(running.id);
      revalidateTime(running.engagement_id, running.client_id);
    }

    let created = await insertTimerStart({
      firmId: firm.id,
      userId: user.id,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      taskId: input.taskId ?? null,
    });
    if (created.conflict) {
      // Two tabs raced the stop. The DB's one-running-timer index caught it;
      // stop the straggler and try once more.
      const straggler = await getRunningEntry(user.id);
      if (straggler) await stopEntry(straggler.id);
      created = await insertTimerStart({
        firmId: firm.id,
        userId: user.id,
        clientId: input.clientId,
        engagementId: input.engagementId ?? null,
        taskId: input.taskId ?? null,
      });
    }
    if (!created.entry) return { ok: false, error: "failed" };

    await snapshotCost(created.entry);
    await logUserActivity(firm.id, created.entry.engagement_id, "time_entry_created", {
      time_entry_id: created.entry.id,
      client_id: created.entry.client_id,
      task_id: created.entry.task_id,
      is_manual: false,
    });
    revalidateTime(created.entry.engagement_id, created.entry.client_id);
    return { ok: true, value: { id: created.entry.id } };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] start failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Stop a timer and save it. The entry id comes from the pill; RLS refuses the
 *  call for anyone who may not touch that entry. */
export async function stopTimerAction(input: {
  entryId: string;
  note?: string | null;
}): Promise<Result<{ id: string; durationMinutes: number }>> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const stopped = await stopEntry(input.entryId, input.note);
    // Already stopped (a second tab won the race) is a fine outcome — the
    // hour is saved either way; report it as such rather than alarming.
    if (!stopped) return { ok: false, error: "failed" };
    revalidateTime(stopped.engagement_id, stopped.client_id);
    return {
      ok: true,
      value: { id: stopped.id, durationMinutes: stopped.duration_minutes },
    };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] stop failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Log time by hand: a day, a duration already parsed to minutes, an optional
 *  note. The day lands at NOON in the firm's timezone so it can never file
 *  itself on the neighbouring date (see lib/time/dates.ts). */
export async function logManualEntryAction(input: {
  clientId: string;
  engagementId?: string | null;
  taskId?: string | null;
  /** YYYY-MM-DD, the accountant's pick. */
  day: string;
  durationMinutes: number;
  note?: string | null;
}): Promise<Result<{ id: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const { user, firm } = g;
  if (!input.clientId) return { ok: false, error: "invalid" };
  const minutes = Math.round(input.durationMinutes);
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    minutes > MANUAL_MAX_MINUTES
  ) {
    return { ok: false, error: "invalid" };
  }
  const startedAt = noonInTimeZone(input.day, firm.timezone);
  if (!startedAt) return { ok: false, error: "invalid" };

  try {
    const entry = await insertManualEntry({
      firmId: firm.id,
      userId: user.id,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      taskId: input.taskId ?? null,
      startedAt,
      durationMinutes: minutes,
      note: input.note?.trim() ? input.note.trim() : null,
    });
    await snapshotCost(entry);
    await logUserActivity(firm.id, entry.engagement_id, "time_entry_created", {
      time_entry_id: entry.id,
      client_id: entry.client_id,
      task_id: entry.task_id,
      is_manual: true,
      duration_minutes: minutes,
    });
    revalidateTime(entry.engagement_id, entry.client_id);
    return { ok: true, value: { id: entry.id } };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] manual log failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Fix an entry — its day, duration, or note. Your own without asking; a
 *  teammate's only with time.manage. RLS makes the refusal real; the check
 *  here only makes it polite. */
export async function updateTimeEntryAction(input: {
  entryId: string;
  day?: string;
  durationMinutes?: number;
  note?: string | null;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const { user, firm } = g;

  const patch: Parameters<typeof updateEntry>[1] = {};
  if (input.day !== undefined) {
    const startedAt = noonInTimeZone(input.day, firm.timezone);
    if (!startedAt) return { ok: false, error: "invalid" };
    patch.startedAt = startedAt;
  }
  if (input.durationMinutes !== undefined) {
    const minutes = Math.round(input.durationMinutes);
    if (
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      minutes > MANUAL_MAX_MINUTES
    ) {
      return { ok: false, error: "invalid" };
    }
    patch.durationMinutes = minutes;
  }
  if (input.note !== undefined) {
    patch.note = input.note?.trim() ? input.note.trim() : null;
  }

  try {
    const updated = await updateEntry(input.entryId, patch);
    // Null = RLS returned no row: either gone, or not the caller's to edit.
    if (!updated) {
      return { ok: false, error: can(user, "time.manage") ? "failed" : "not_allowed" };
    }
    await logUserActivity(firm.id, updated.engagement_id, "time_entry_updated", {
      time_entry_id: updated.id,
      client_id: updated.client_id,
      edited_own: updated.user_id === user.id,
    });
    revalidateTime(updated.engagement_id, updated.client_id);
    return { ok: true };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] update failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Remove an entry — a soft delete under the 0139 lifecycle. Same rule as
 *  editing: yours, or time.manage. */
export async function deleteTimeEntryAction(input: {
  entryId: string;
  /** For revalidation — the row is gone by the time we would ask it. */
  engagementId?: string | null;
  clientId?: string | null;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const { user, firm } = g;
  try {
    const deleted = await softDeleteEntry(input.entryId, user.id);
    if (!deleted) {
      return { ok: false, error: can(user, "time.manage") ? "failed" : "not_allowed" };
    }
    await logUserActivity(firm.id, input.engagementId ?? null, "time_entry_deleted", {
      time_entry_id: input.entryId,
      client_id: input.clientId ?? null,
    });
    revalidateTime(input.engagementId, input.clientId);
    return { ok: true };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] delete failed:", err);
    return { ok: false, error: "failed" };
  }
}
