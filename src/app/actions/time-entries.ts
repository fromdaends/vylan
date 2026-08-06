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
import { dateInTimeZone } from "@/lib/tasks/dates";
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
import {
  listBillableRates,
  valueCents,
  writeBillableSnapshotSR,
} from "@/lib/db/time-billing";
import { listClients, getClient } from "@/lib/db/clients";
import { listEngagements, getEngagement } from "@/lib/db/engagements";
import { TIMER_MAX_MINUTES } from "@/lib/db/time-entries";
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
    // Stop the current timer, if any. Its note stays as typed — and it gets
    // its BILLABLE SNAPSHOT here, exactly as a hand-stopped timer would: this
    // auto-stop IS that entry's save, and skipping the snapshot would leave
    // every switched-away-from entry valueless forever (freeze-first, so a
    // replay never reprices).
    const running = await getRunningEntry(user.id);
    if (running) {
      await stopEntry(running.id);
      await writeBillableSnapshotSR({
        timeEntryId: running.id,
        firmId: firm.id,
        userId: user.id,
      });
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
      if (straggler) {
        await stopEntry(straggler.id);
        await writeBillableSnapshotSR({
          timeEntryId: straggler.id,
          firmId: firm.id,
          userId: user.id,
        });
      }
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
 *  call for anyone who may not touch that entry. Already-stopped (a second tab
 *  won the race) is a SUCCESS — stopEntry hands back the finished row either
 *  way; null means the entry is genuinely gone. */
export async function stopTimerAction(input: {
  entryId: string;
  note?: string | null;
}): Promise<
  Result<{
    id: string;
    durationMinutes: number;
    day: string;
    /** True when the 12h clamp decided the end, not the click. */
    clamped: boolean;
    /** The saved entry's value at the member's billable rate, or null when no
     *  rate is set (shown as "no value", never $0). Own entry → always
     *  visible to its author, by the billing table's own RLS. */
    valueCents: number | null;
  }>
> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const stopped = await stopEntry(input.entryId, input.note);
    if (!stopped) return { ok: false, error: "failed" };
    // VALUE at save (timer v2): freeze the member's billable rate onto the
    // entry, then read it back as the caller for the save sheet. The write is
    // service-role (the table has no session write path, by design).
    await writeBillableSnapshotSR({
      timeEntryId: stopped.id,
      firmId: stopped.firm_id,
      userId: stopped.user_id,
    });
    const rates = await listBillableRates([stopped.id]);
    const rate = rates.get(stopped.id) ?? null;
    revalidateTime(stopped.engagement_id, stopped.client_id);
    return {
      ok: true,
      value: {
        id: stopped.id,
        durationMinutes: stopped.duration_minutes,
        // The entry's day in the FIRM's calendar, for the save sheet — the
        // browser's "today" is the wrong answer for an overnight timer.
        day:
          dateInTimeZone(stopped.started_at, g.firm.timezone) ??
          stopped.started_at.slice(0, 10),
        clamped: stopped.duration_minutes >= TIMER_MAX_MINUTES,
        valueCents:
          rate == null ? null : valueCents(stopped.duration_minutes, rate),
      },
    };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] stop failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Discard the caller's RUNNING timer without saving — the "discard" arm of
 *  the start-a-second-timer prompt. A soft delete like any other, so a
 *  mis-click is recoverable in the database even though the UI treats it as
 *  gone. Refuses (via RLS) to touch anything that is not the caller's own. */
export async function discardRunningTimerAction(input: {
  entryId: string;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const running = await getRunningEntry(g.user.id);
    // Only the caller's CURRENT running entry may be discarded through this
    // path — a stale id from a previous render must not delete a saved entry.
    if (!running || running.id !== input.entryId) {
      return { ok: false, error: "failed" };
    }
    const deleted = await softDeleteEntry(input.entryId, g.user.id);
    if (!deleted) return { ok: false, error: "failed" };
    await logUserActivity(g.firm.id, running.engagement_id, "time_entry_deleted", {
      time_entry_id: input.entryId,
      client_id: running.client_id,
      discarded_running: true,
    });
    revalidateTime(running.engagement_id, running.client_id);
    return { ok: true };
  } catch (err) {
    if (err instanceof TimeEntriesUnsupportedError) {
      return { ok: false, error: "unsupported" };
    }
    console.error("[time] discard failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Resolve the page the user is standing on into timer prefill — the ONE
 *  "detection" the spec allows: a single route-context read at press time.
 *  RLS-scoped reads, so a client the caller may not see resolves to nothing. */
export async function getTimeContextAction(input: {
  clientId?: string | null;
  engagementId?: string | null;
}): Promise<
  Result<{
    clientId: string | null;
    clientName: string | null;
    engagementId: string | null;
    engagementTitle: string | null;
  }>
> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    if (input.engagementId) {
      const engagement = await getEngagement(input.engagementId);
      if (engagement) {
        const client = await getClient(engagement.client_id);
        return {
          ok: true,
          value: {
            clientId: engagement.client_id,
            clientName: client?.display_name ?? null,
            engagementId: engagement.id,
            engagementTitle: engagement.title,
          },
        };
      }
    }
    if (input.clientId) {
      const client = await getClient(input.clientId);
      if (client) {
        return {
          ok: true,
          value: {
            clientId: client.id,
            clientName: client.display_name,
            engagementId: null,
            engagementTitle: null,
          },
        };
      }
    }
    return {
      ok: true,
      value: {
        clientId: null,
        clientName: null,
        engagementId: null,
        engagementTitle: null,
      },
    };
  } catch (err) {
    console.error("[time] context failed:", err);
    return { ok: false, error: "failed" };
  }
}

/** Picker data for the ask-on-start sheet, loaded WHEN THE SHEET OPENS rather
 *  than on every page render (the shell must not pay for a closed sheet).
 *  Clients always; engagements only once a client is chosen. */
export async function listTimePickerDataAction(input: {
  clientId?: string | null;
}): Promise<
  Result<{
    clients: { id: string; name: string }[];
    engagements: { id: string; title: string }[];
  }>
> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const [clients, engagements] = await Promise.all([
      listClients({}),
      input.clientId
        ? listEngagements({ client_id: input.clientId })
        : Promise.resolve([]),
    ]);
    return {
      ok: true,
      value: {
        clients: clients.map((c) => ({ id: c.id, name: c.display_name })),
        engagements: engagements.map((e) => ({ id: e.id, title: e.title })),
      },
    };
  } catch (err) {
    console.error("[time] picker data failed:", err);
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
    // A manual entry IS its save — the billable snapshot freezes here, same
    // moment a timer's freezes at stop.
    await writeBillableSnapshotSR({
      timeEntryId: entry.id,
      firmId: entry.firm_id,
      userId: entry.user_id,
    });
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
