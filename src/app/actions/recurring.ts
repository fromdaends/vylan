"use server";

// Server actions for recurring engagement series (Phase 1): the engagement
// page's Repeat dialog. The builder's create-with-repeat path reuses the same
// core (src/lib/recurring/enable.ts) from createEngagementAction.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import { listRequestItems } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import {
  endRecurringSeries,
  getRecurringSeries,
  updateRecurringSeries,
  type RecurringSeries,
} from "@/lib/db/recurring";
import { applyRepeatChoice } from "@/lib/recurring/enable";
import { snapshotFromRequestItems } from "@/lib/recurring/snapshot";
import { spawnSeriesNow } from "@/lib/recurring/spawn";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import { localToday, nextSpawn, toIsoDate } from "@/lib/recurring/schedule";

// Same permissive uuid check as actions/engagements.ts (seed data isn't
// strictly RFC 4122).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RepeatSchema = z.object({
  engagementId: z.string().regex(UUID_REGEX),
  frequency: z.enum(["off", "monthly", "quarterly", "yearly"]),
  dueOffsetDays: z.number().int().min(1).max(365),
});

export type RepeatEditResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "not_found" | "no_documents" | "save_failed" };

export async function setEngagementRepeatAction(input: {
  engagementId: string;
  frequency: "off" | "monthly" | "quarterly" | "yearly";
  dueOffsetDays: number;
}): Promise<RepeatEditResult> {
  const parsed = RepeatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const [user, firm, engagement] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getEngagement(parsed.data.engagementId),
  ]);
  if (!user || !firm || !engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  try {
    if (parsed.data.frequency === "off") {
      // Turning repeat off = END the series (stop future spawns). Existing
      // engagements are untouched; the ledger survives so past periods can
      // never re-spawn even if repeat is turned back on later.
      if (engagement.series_id) {
        const series = await getRecurringSeries(engagement.series_id);
        if (series && series.status !== "ended") {
          await endRecurringSeries(series.id);
        }
      }
      revalidatePath(`/engagements/${engagement.id}`);
      return { ok: true };
    }

    // A series spawns engagements that must be sendable — an empty checklist
    // would create occurrences the client can't act on (the send flow itself
    // blocks zero-document engagements).
    const items = snapshotFromRequestItems(
      await listRequestItems(engagement.id),
    );
    if (items.length === 0) {
      return { ok: false, error: "no_documents" };
    }

    await applyRepeatChoice({
      engagement,
      firmTimezone: firm.timezone,
      userId: user.id,
      frequency: parsed.data.frequency,
      dueOffsetDays: parsed.data.dueOffsetDays,
      itemsSnapshot: items,
    });
    revalidatePath(`/engagements/${engagement.id}`);
    return { ok: true };
  } catch (error) {
    console.error("[setEngagementRepeatAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}

export type SpawnNowResult =
  | { ok: true; engagementId: string; title: string }
  | { ok: false; error: "not_found" | "duplicate" | "spawn_failed" };

// The founder test hook: force-spawn the series' next occurrence immediately.
// AUTH here (RLS-scoped series read proves firm ownership); the actual spawn
// runs in the service-role core — the SAME path the hourly cron uses, so this
// button demonstrates real behavior, including the anti-duplicate ledger
// (clicking twice targets the same period and the second click no-ops).
// NOTE: this sends the REAL invite email to the client, like any spawn.
export async function spawnSeriesNowAction(input: {
  seriesId: string;
}): Promise<SpawnNowResult> {
  const parsedId = z
    .string()
    .regex(UUID_REGEX)
    .safeParse(input.seriesId);
  if (!parsedId.success) return { ok: false, error: "not_found" };

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "not_found" };
  // RLS-scoped read: resolves only within the caller's firm.
  const series = await getRecurringSeries(parsedId.data);
  if (!series || series.firm_id !== firm.id || series.status !== "active") {
    return { ok: false, error: "not_found" };
  }

  try {
    const outcome = await spawnSeriesNow(series.id);
    if (!outcome.ok) {
      return {
        ok: false,
        error: outcome.reason === "duplicate" ? "duplicate" : "spawn_failed",
      };
    }
    revalidatePath(`/engagements/${outcome.engagementId}`);
    revalidatePath("/engagements");
    revalidatePath("/dashboard");
    return {
      ok: true,
      engagementId: outcome.engagementId,
      title: outcome.title,
    };
  } catch (error) {
    console.error("[spawnSeriesNowAction] failed:", error);
    return { ok: false, error: "spawn_failed" };
  }
}

// ── Series management (Phase 3): pause / resume / end / edit-future ─────────

export type SeriesControlResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "no_documents" | "save_failed" };

// Shared auth prologue: the caller must own BOTH the series and the engagement
// whose page the dialog sits on (the activity log anchors to the engagement).
async function authorizeSeriesControl(input: {
  seriesId: string;
  engagementId: string;
}): Promise<
  | { firmId: string; series: RecurringSeries; firmTimezone: string }
  | null
> {
  const idOk =
    UUID_REGEX.test(input.seriesId) && UUID_REGEX.test(input.engagementId);
  if (!idOk) return null;
  const [user, firm, series, engagement] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getRecurringSeries(input.seriesId),
    getEngagement(input.engagementId),
  ]);
  if (
    !user ||
    !firm ||
    !series ||
    series.firm_id !== firm.id ||
    !engagement ||
    engagement.firm_id !== firm.id
  ) {
    return null;
  }
  return { firmId: firm.id, series, firmTimezone: firm.timezone };
}

export async function pauseSeriesAction(input: {
  seriesId: string;
  engagementId: string;
}): Promise<SeriesControlResult> {
  const ctx = await authorizeSeriesControl(input);
  if (!ctx || ctx.series.status !== "active") {
    return { ok: false, error: "not_found" };
  }
  try {
    await updateRecurringSeries(ctx.series.id, {
      status: "paused",
      paused_at: new Date().toISOString(),
    });
    await logUserActivity(ctx.firmId, input.engagementId, "recurrence_paused", {
      series_id: ctx.series.id,
    });
    revalidatePath(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (error) {
    console.error("[pauseSeriesAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}

export async function resumeSeriesAction(input: {
  seriesId: string;
  engagementId: string;
}): Promise<SeriesControlResult> {
  const ctx = await authorizeSeriesControl(input);
  if (!ctx || ctx.series.status !== "paused") {
    return { ok: false, error: "not_found" };
  }
  try {
    // FORWARD-ONLY: the next occurrence is scheduled from today, on the
    // series' anchor day. Cycles missed while paused are never backfilled.
    const today = localToday(ctx.firmTimezone);
    await updateRecurringSeries(ctx.series.id, {
      status: "active",
      paused_at: null,
      next_spawn_on: toIsoDate(
        nextSpawn(today, ctx.series.frequency, ctx.series.anchor_day),
      ),
    });
    await logUserActivity(
      ctx.firmId,
      input.engagementId,
      "recurrence_resumed",
      { series_id: ctx.series.id },
    );
    revalidatePath(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (error) {
    console.error("[resumeSeriesAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}

export async function endSeriesAction(input: {
  seriesId: string;
  engagementId: string;
}): Promise<SeriesControlResult> {
  const ctx = await authorizeSeriesControl(input);
  if (!ctx || ctx.series.status === "ended") {
    return { ok: false, error: "not_found" };
  }
  try {
    // Status change only: every existing engagement (and the ledger) stays
    // exactly as it is — ending stops FUTURE spawns, touches nothing else.
    await endRecurringSeries(ctx.series.id);
    await logUserActivity(ctx.firmId, input.engagementId, "recurrence_ended", {
      series_id: ctx.series.id,
    });
    revalidatePath(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (error) {
    console.error("[endSeriesAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}

// Edit-future: re-snapshot THIS engagement's current checklist + reminder
// settings + AI toggle onto the series, so every FUTURE occurrence copies the
// updated set. Structurally incapable of touching existing engagements — the
// series row is the only thing written.
export async function refreshSeriesSnapshotAction(input: {
  seriesId: string;
  engagementId: string;
}): Promise<SeriesControlResult> {
  const ctx = await authorizeSeriesControl(input);
  if (!ctx || ctx.series.status === "ended") {
    return { ok: false, error: "not_found" };
  }
  try {
    const engagement = await getEngagement(input.engagementId);
    if (!engagement) return { ok: false, error: "not_found" };
    const items = snapshotFromRequestItems(
      await listRequestItems(input.engagementId),
    );
    if (items.length === 0) return { ok: false, error: "no_documents" };
    await updateRecurringSeries(ctx.series.id, {
      items,
      ai_enabled: engagement.ai_enabled !== false,
      reminder_settings: normalizeReminderSettings(
        engagement.reminder_settings,
      ),
    });
    await logUserActivity(
      ctx.firmId,
      input.engagementId,
      "recurrence_updated",
      { series_id: ctx.series.id, items_count: items.length },
    );
    revalidatePath(`/engagements/${input.engagementId}`);
    return { ok: true };
  } catch (error) {
    console.error("[refreshSeriesSnapshotAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}
