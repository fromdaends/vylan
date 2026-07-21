// The recurring-engagement spawner (Phase 2). Service-role core shared by the
// hourly cron (/api/cron/spawn-recurrences) and the founder-facing "Spawn next
// occurrence now" test action — one code path, so the test proves exactly what
// the schedule will do.
//
// IDEMPOTENCY (the load-bearing design):
//   1. The occurrence LEDGER row is inserted FIRST, before anything else is
//      created. UNIQUE(series_id, period_key) makes the database itself
//      reject a second spawn of the same period — under cron overlap, retry,
//      manual-vs-cron races, anything.
//   2. If creating the engagement then fails, the ledger row is deleted
//      (compensating action) so the period can retry on the next run. If the
//      process dies between the two steps, the period stays burned — by
//      design: a rare missed spawn (visible, recoverable by hand) is
//      acceptable; a duplicate spawn to a client is not.
//   3. A duplicate ledger hit still ADVANCES the series schedule (cron mode),
//      so a series can never wedge on an already-spawned period.
//
// NO BACKFILL: resolveDueSpawn picks only the latest due period; downtime or
// a long pause never causes a spawn storm (see schedule.ts).

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { newMagicToken } from "@/lib/db/engagements";
import type { RecurringSeries } from "@/lib/db/recurring";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import { scheduleEngagementReminders } from "@/lib/reminders";
import { syncEngagementStageSR } from "@/lib/engagements/stage-sync";
import { buildEngagementInviteEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import {
  dueDateFor,
  localToday,
  parseIsoDate,
  periodKeyFor,
  resolveDueSpawn,
  toIsoDate,
  type LocalDate,
} from "./schedule";
import { occurrenceTitle } from "./naming";

// How many due series one cron run will process. Hourly cadence means a
// backlog larger than this simply drains over the next runs.
const MAX_SERIES_PER_RUN = 50;

export type SpawnOutcome =
  | { ok: true; engagementId: string; periodKey: string; title: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_active"
        | "not_due"
        | "duplicate"
        | "client_unavailable"
        | "empty_checklist"
        | "create_failed";
    };

type FirmRow = {
  id: string;
  name: string;
  timezone: string;
  logo_url: string | null;
};

type ClientRow = {
  id: string;
  display_name: string;
  email: string | null;
  locale: string | null;
  archived_at: string | null;
};

type Sb = ReturnType<typeof getServiceRoleSupabase>;

// ── The cron entry point ────────────────────────────────────────────────────

export async function spawnDueRecurrences(now: Date = new Date()): Promise<{
  checked: number;
  results: { seriesId: string; outcome: SpawnOutcome }[];
}> {
  const sb = getServiceRoleSupabase();

  // Candidate window: anything scheduled up to UTC-tomorrow, so no firm
  // timezone (up to UTC+14) is ever missed; the precise firm-local "is it due
  // today?" check happens per series below.
  const utcNow = new Date(now);
  utcNow.setUTCDate(utcNow.getUTCDate() + 1);
  const windowIso = utcNow.toISOString().slice(0, 10);

  const { data: seriesRows, error } = await sb
    .from("recurring_series")
    .select("*")
    .eq("status", "active")
    .lte("next_spawn_on", windowIso)
    .order("next_spawn_on", { ascending: true })
    .limit(MAX_SERIES_PER_RUN);
  if (error) throw error;

  const candidates = (seriesRows ?? []) as RecurringSeries[];
  const results: { seriesId: string; outcome: SpawnOutcome }[] = [];
  if (candidates.length === 0) return { checked: 0, results };

  const firmIds = [...new Set(candidates.map((s) => s.firm_id))];
  const { data: firmRows } = await sb
    .from("firms")
    .select("id, name, timezone, logo_url")
    .in("id", firmIds);
  const firmById = new Map(
    ((firmRows ?? []) as FirmRow[]).map((f) => [f.id, f]),
  );

  for (const series of candidates) {
    const firm = firmById.get(series.firm_id);
    if (!firm) {
      results.push({
        seriesId: series.id,
        outcome: { ok: false, reason: "not_found" },
      });
      continue;
    }
    const today = localToday(firm.timezone, now);
    const scheduled = parseIsoDate(series.next_spawn_on);
    if (!scheduled) {
      results.push({
        seriesId: series.id,
        outcome: { ok: false, reason: "create_failed" },
      });
      continue;
    }
    const due = resolveDueSpawn({
      nextSpawnOn: scheduled,
      frequency: series.frequency,
      anchorDay: series.anchor_day,
      today,
    });
    if (!due) {
      // In the UTC window but not due in the firm's own calendar yet.
      results.push({
        seriesId: series.id,
        outcome: { ok: false, reason: "not_due" },
      });
      continue;
    }
    const outcome = await spawnOccurrence(sb, series, firm, {
      spawnDate: due.spawnDate,
      periodKey: due.periodKey,
      // Cron mode: the schedule advances past today even on duplicate, so an
      // already-spawned period can never wedge the series.
      advanceTo: toIsoDate(due.nextSpawnOn),
    });
    results.push({ seriesId: series.id, outcome });
  }
  return { checked: candidates.length, results };
}

// ── The founder test hook ("Spawn next occurrence now") ─────────────────────

// Force-spawn the series' NEXT scheduled period immediately, without waiting
// for its date — and WITHOUT advancing next_spawn_on. Consequences, both
// deliberate:
//   * Clicking again targets the SAME period -> ledger duplicate -> no-op.
//     The button is a live demonstration of the idempotency guarantee.
//   * When the real date arrives, the cron finds the period already ledgered,
//     advances the schedule, and creates nothing. Normal service resumes.
export async function spawnSeriesNow(seriesId: string): Promise<SpawnOutcome> {
  const sb = getServiceRoleSupabase();
  const { data: seriesRow } = await sb
    .from("recurring_series")
    .select("*")
    .eq("id", seriesId)
    .maybeSingle();
  const series = (seriesRow as RecurringSeries) ?? null;
  if (!series) return { ok: false, reason: "not_found" };
  if (series.status !== "active") return { ok: false, reason: "not_active" };
  const { data: firmRow } = await sb
    .from("firms")
    .select("id, name, timezone, logo_url")
    .eq("id", series.firm_id)
    .maybeSingle();
  if (!firmRow) return { ok: false, reason: "not_found" };
  const scheduled = parseIsoDate(series.next_spawn_on);
  if (!scheduled) return { ok: false, reason: "create_failed" };
  return spawnOccurrence(sb, series, firmRow as FirmRow, {
    spawnDate: scheduled,
    periodKey: periodKeyFor(series.frequency, scheduled),
    advanceTo: null,
  });
}

// ── The one spawn path ──────────────────────────────────────────────────────

async function spawnOccurrence(
  sb: Sb,
  series: RecurringSeries,
  firm: FirmRow,
  plan: {
    spawnDate: LocalDate;
    periodKey: string;
    // ISO date to move next_spawn_on to after handling this period (cron
    // mode), or null to leave the schedule untouched (the test hook).
    advanceTo: string | null;
  },
): Promise<SpawnOutcome> {
  const advance = async () => {
    if (!plan.advanceTo) return;
    await sb
      .from("recurring_series")
      .update({ next_spawn_on: plan.advanceTo })
      .eq("id", series.id);
  };

  // The client must still be available. An archived (or vanished) client
  // auto-PAUSES the series instead of spawning work nobody can act on — the
  // founder resumes it from the Repeat dialog after un-archiving.
  const { data: clientRow } = await sb
    .from("clients")
    .select("id, display_name, email, locale, archived_at")
    .eq("id", series.client_id)
    .maybeSingle();
  const client = (clientRow as ClientRow) ?? null;
  if (!client || client.archived_at) {
    await sb
      .from("recurring_series")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", series.id);
    return { ok: false, reason: "client_unavailable" };
  }

  // A series with an empty snapshot can't spawn a sendable engagement
  // (the send flow blocks zero-document engagements). Pause it — the enable
  // path guards against this, so reaching here means manual data damage.
  const items = Array.isArray(series.items) ? series.items : [];
  if (items.length === 0) {
    await sb
      .from("recurring_series")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", series.id);
    return { ok: false, reason: "empty_checklist" };
  }

  // STEP 1 — the ledger, FIRST. The unique constraint is the guarantee.
  const { error: ledgerErr } = await sb.from("recurring_occurrences").insert({
    series_id: series.id,
    firm_id: series.firm_id,
    period_key: plan.periodKey,
    engagement_id: null,
  });
  if (ledgerErr) {
    if (ledgerErr.code === "23505") {
      // Period already spawned. Advance (cron) so the series moves on.
      await advance();
      return { ok: false, reason: "duplicate" };
    }
    throw ledgerErr;
  }

  // STEP 2 — create the engagement, already SENT with a fresh portal link so
  // the chase starts on its own (the whole point of the feature).
  const clientLocale: "en" | "fr" = client.locale === "en" ? "en" : "fr";
  const title = occurrenceTitle(
    series.title,
    series.frequency,
    plan.spawnDate,
    clientLocale,
  );
  const dueDate = dueDateFor(plan.spawnDate, series.due_offset_days);
  const reminderSettings = normalizeReminderSettings(series.reminder_settings);
  const nowIso = new Date().toISOString();
  const token = newMagicToken();
  const magicExpires = new Date();
  magicExpires.setDate(magicExpires.getDate() + 90);

  const { data: engagement, error: engErr } = await sb
    .from("engagements")
    .insert({
      firm_id: series.firm_id,
      client_id: series.client_id,
      title,
      type: series.type,
      status: "sent",
      due_date: dueDate,
      sent_at: nowIso,
      magic_token: token,
      magic_expires_at: magicExpires.toISOString(),
      ai_enabled: series.ai_enabled,
      reminder_settings: reminderSettings,
      series_id: series.id,
      series_period: plan.periodKey,
      // Accountability defaults to whoever set the series up (may be null).
      assigned_user_id: series.created_by_user_id,
      ...(series.created_by_user_id ? { assigned_at: nowIso } : {}),
    })
    .select("id")
    .single();

  if (engErr || !engagement) {
    // Compensate: free the period so the next run can retry. If THIS delete
    // fails too, the period stays burned — logged loudly, never duplicated.
    console.error("[recurring] engagement create failed:", engErr);
    const { error: undoErr } = await sb
      .from("recurring_occurrences")
      .delete()
      .eq("series_id", series.id)
      .eq("period_key", plan.periodKey)
      .is("engagement_id", null);
    if (undoErr) {
      console.error(
        "[recurring] COMPENSATING DELETE FAILED — period burned without an engagement:",
        series.id,
        plan.periodKey,
        undoErr,
      );
    }
    return { ok: false, reason: "create_failed" };
  }
  const engagementId = engagement.id as string;

  // STEP 3 — copy the checklist snapshot (same shape createEngagementWithItems
  // writes). Failure compensates both inserts.
  const itemRows = items.map((item, idx) => ({
    engagement_id: engagementId,
    label: item.label_en,
    label_fr: item.label_fr,
    description: item.description_en ?? null,
    description_fr: item.description_fr ?? null,
    doc_type: item.doc_type,
    required: item.required,
    order_index: idx,
  }));
  const { error: itemsErr } = await sb.from("request_items").insert(itemRows);
  if (itemsErr) {
    console.error("[recurring] items copy failed:", itemsErr);
    await sb.from("engagements").delete().eq("id", engagementId);
    const { error: undoErr } = await sb
      .from("recurring_occurrences")
      .delete()
      .eq("series_id", series.id)
      .eq("period_key", plan.periodKey);
    if (undoErr) {
      console.error(
        "[recurring] COMPENSATING DELETE FAILED after items failure:",
        series.id,
        plan.periodKey,
        undoErr,
      );
    }
    return { ok: false, reason: "create_failed" };
  }

  // The occurrence exists — everything past this point is enrichment and must
  // never undo it. Back-fill the ledger's engagement pointer (best-effort).
  await sb
    .from("recurring_occurrences")
    .update({ engagement_id: engagementId })
    .eq("series_id", series.id)
    .eq("period_key", plan.periodKey);
  await advance();

  // Reminders: the standard queue jobs; the worker self-skips as items
  // complete, exactly like a hand-sent engagement.
  try {
    await scheduleEngagementReminders({
      engagementId,
      sentAt: new Date(nowIso),
      dueDate,
      settings: reminderSettings,
    });
  } catch (e) {
    console.error("[recurring] reminder scheduling failed:", e);
  }

  // Workflow stage (self-heals on later events if this hiccups).
  try {
    await syncEngagementStageSR(engagementId);
  } catch (e) {
    console.error("[recurring] stage sync failed:", e);
  }

  // Activity trail.
  try {
    await sb.from("activity_log").insert({
      firm_id: series.firm_id,
      engagement_id: engagementId,
      actor_type: "system",
      action: "recurrence_spawned",
      metadata: { series_id: series.id, period_key: plan.periodKey },
    });
  } catch (e) {
    console.error("[recurring] activity log failed:", e);
  }

  // Invite email — same content path as a hand-sent engagement; best-effort.
  if (client.email) {
    try {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const { subject, html, text } = buildEngagementInviteEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        engagementTitle: title,
        url: `${appUrl}/r/${token}`,
        dueDate,
        locale: clientLocale,
      });
      await sendEmail({ to: client.email, subject, html, text });
    } catch (e) {
      console.error("[recurring] invite email failed:", e);
    }
  }

  return { ok: true, engagementId, periodKey: plan.periodKey, title };
}
