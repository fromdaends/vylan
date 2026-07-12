// Vercel Cron handler — runs every 2 minutes (see vercel.json).
//
// Auth model:
//   * In production: Vercel injects `Authorization: Bearer <CRON_SECRET>` from
//     the env var of the same name. Header-only — never accept the secret via
//     query string, as URL params leak to logs/Referer.
//   * In dev (NODE_ENV !== "production"): the ?secret= fallback is allowed
//     so `curl localhost:3000/api/cron/...` works without forging headers.

import { NextResponse, type NextRequest } from "next/server";
import {
  claimDueJobs,
  markJobDone,
  markJobFailed,
  type Job,
} from "@/lib/db/jobs";
import { processReminderJob } from "@/lib/reminders";
import { processClassifyJob } from "@/lib/ai/process";
import { processSetAssessmentJob } from "@/lib/ai/set-assessment";
import { processNotifyClientRetryJob } from "@/lib/notify-retry";
import { processSyncQuickbooksJob } from "@/lib/quickbooks/sync";
import { sendEngagementInvoice } from "@/lib/invoices/send";
import {
  backfillContentHashes,
  type BackfillResult,
} from "@/lib/files/backfill-content-hash";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tuning. The function is capped at maxDuration (60s); we stop starting new work
// well before that (SOFT_DEADLINE_MS) and process WAVE_SIZE reads concurrently,
// so a burst of uploads drains fast WITHOUT ever overrunning the limit and
// orphaning half-processed jobs (the old "stuck on AI Analyzing" bug).
const SOFT_DEADLINE_MS = 50_000;
const MIN_WAVE_HEADROOM_MS = 15_000;
const WAVE_SIZE = 4;

// Classify skips that are TRANSIENT (a storage hiccup or an empty model reply)
// must be retried, not marked done — otherwise the file is stuck on "Analyzing"
// forever. Permanent skips (no API key, file gone, no expected type) are done.
const RETRYABLE_SKIPS = new Set([
  "download_failed",
  "no_classification",
  // Firm couldn't be resolved (transient engagement read) — the gate failed
  // closed instead of spending uncapped AI; retry so a blip self-heals.
  "firm_not_resolved",
]);

// Set-assessment transient skips worth a retry: a storage hiccup or an empty
// model reply. Everything else is terminal-done — note "set_changed" is
// deliberately NOT here: it means a newer upload already scheduled a fresh job,
// so this stale run should just be marked done, not retried.
const RETRYABLE_SET_SKIPS = new Set(["download_failed", "no_result"]);

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && expected.trim() !== "") {
    const authHeader = request.headers.get("authorization") ?? "";
    let ok = authHeader === `Bearer ${expected}`;
    if (!ok && process.env.NODE_ENV !== "production") {
      const queryToken =
        new URL(request.url).searchParams.get("secret") ?? "";
      ok = queryToken === expected;
    }
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Drain the queue in small concurrent waves until we run low on time. Each
  // wave only claims what it is about to run, and we stop before the soft
  // deadline — so a run NEVER abandons claimed jobs mid-flight. Anything a hard
  // crash still strands is reclaimed by the lease in claimDueJobs on a later run.
  const startedAt = Date.now();
  const remaining = () => SOFT_DEADLINE_MS - (Date.now() - startedAt);
  const results: { id: string; kind: string; ok: boolean; detail?: unknown }[] =
    [];
  let claimedTotal = 0;

  while (remaining() > MIN_WAVE_HEADROOM_MS) {
    const wave = await claimDueJobs(WAVE_SIZE);
    if (wave.length === 0) break;
    claimedTotal += wave.length;
    const settled = await Promise.all(wave.map((job) => runJob(job)));
    results.push(...settled);
  }

  // Duplicate-detection backfill: hash a small batch of legacy uploads
  // (content_hash IS NULL, pre-migration-0270) per run until none remain, so
  // duplicate detection covers EVERY engagement's history, not just files
  // uploaded after the feature shipped. Runs only with budget left over after
  // the job queue; a no-op once drained (one cheap SELECT).
  let backfill: BackfillResult | null = null;
  if (remaining() > MIN_WAVE_HEADROOM_MS) {
    try {
      backfill = await backfillContentHashes(getServiceRoleSupabase());
    } catch (e) {
      console.error("[cron] content-hash backfill failed:", e);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    claimed: claimedTotal,
    results,
    backfill,
  });
}

// Run one job, then mark it done / failed. NEVER throws: a thrown job would
// reject the whole wave's Promise.all and could leave its siblings leased but
// unresolved until reclaim. Every failure path routes through markJobFailed so
// attempts + backoff stay consistent.
async function runJob(
  job: Job,
): Promise<{ id: string; kind: string; ok: boolean; detail?: unknown }> {
  try {
    if (job.kind === "send_reminder") {
      const detail = await processReminderJob(job.payload);
      await markJobDone(job.id);
      return { id: job.id, kind: job.kind, ok: true, detail };
    }
    if (job.kind === "classify_document") {
      const detail = await processClassifyJob(job.payload);
      if (detail.skipped && RETRYABLE_SKIPS.has(detail.skipped)) {
        // Transient — send it back for another pass instead of marking done.
        await markJobFailed(job.id, `skip:${detail.skipped}`);
        return { id: job.id, kind: job.kind, ok: false, detail };
      }
      await markJobDone(job.id);
      return { id: job.id, kind: job.kind, ok: true, detail };
    }
    if (job.kind === "assess_item_set") {
      const detail = await processSetAssessmentJob(job.payload);
      if (detail.skipped && RETRYABLE_SET_SKIPS.has(detail.skipped)) {
        await markJobFailed(job.id, `skip:${detail.skipped}`);
        return { id: job.id, kind: job.kind, ok: false, detail };
      }
      await markJobDone(job.id);
      return { id: job.id, kind: job.kind, ok: true, detail };
    }
    if (job.kind === "notify_client_retry") {
      const detail = await processNotifyClientRetryJob(job.payload);
      await markJobDone(job.id);
      return { id: job.id, kind: job.kind, ok: true, detail };
    }
    if (job.kind === "sync_quickbooks") {
      const detail = await processSyncQuickbooksJob(job.payload);
      // Retry TRANSIENT failures (a QBO blip, a partial pull, a cache-write hiccup)
      // via the queue's backoff + attempt cap, so a firm is never stuck with a
      // permanently-unpopulated cache. Finalize success + the permanent
      // no_firm_id. (The sync also records its outcome in the firm's sync state.)
      if (detail.ok || detail.detail === "no_firm_id") {
        await markJobDone(job.id);
      } else {
        await markJobFailed(job.id, `sync:${detail.detail}`);
      }
      return { id: job.id, kind: job.kind, ok: detail.ok, detail };
    }
    if (job.kind === "send_payment_request") {
      // Delayed invoice (N days after completion). The helper re-validates the
      // engagement is still complete + Connect-ready and is idempotent, so a
      // reopened/already-invoiced engagement just no-ops. Retry ONLY a
      // transient save failure; every other outcome is terminal (done).
      const result = await sendEngagementInvoice(
        String(job.payload.engagementId ?? ""),
      );
      if (!result.ok && result.reason === "save_failed") {
        await markJobFailed(job.id, `invoice:${result.reason}`);
        return { id: job.id, kind: job.kind, ok: false, detail: result };
      }
      await markJobDone(job.id);
      return { id: job.id, kind: job.kind, ok: result.ok, detail: result };
    }
    // Unknown kind: nothing to do — mark done so it doesn't spin.
    await markJobDone(job.id);
    return { id: job.id, kind: job.kind, ok: false, detail: "unknown_kind" };
  } catch (e) {
    console.error("[cron] job failed:", job.id, e);
    await markJobFailed(job.id, (e as Error).message ?? String(e));
    return {
      id: job.id,
      kind: job.kind,
      ok: false,
      detail: (e as Error).message,
    };
  }
}
