// Poor-man's job queue backed by the `jobs` table (RLS-disabled, only the
// service role touches it). Workers in /api/cron/process-jobs claim a batch
// of due jobs atomically, run them, then mark them done or failed.

import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type JobKind =
  | "send_reminder"
  | "classify_document"
  // Queued by the Phase 3 router when an upload should be auto-rejected.
  // Handler ships in Phase 4 (UnusableDocRetry email + SMS); until then
  // the cron route will absorb these as `unknown_kind` (non-fatal).
  | "notify_client_retry";
export type JobStatus = "pending" | "running" | "done" | "failed";

export type Job = {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  run_after: string;
  attempts: number;
  last_error: string | null;
  status: JobStatus;
  created_at: string;
};

// How many processing attempts before a job is abandoned (marked "failed")
// rather than retried forever — bounds runaway retries on a genuinely
// unprocessable job.
export const MAX_ATTEMPTS = 5;

// A claimed job "leases" its row for this long: claiming pushes run_after this
// far into the future. A worker that dies mid-job leaves the row "running", but
// once the lease lapses the row is due again and the next run reclaims it — so
// nothing can sit "running" (i.e. a document stuck on "AI Analyzing") forever.
// The cron itself is capped at 60s, so a still-legitimately-running job can
// never be older than this; anything past the lease is genuinely orphaned.
export const LEASE_MS = 90 * 1000;

// Pure claim decision: give up once attempts are exhausted, otherwise claim as
// the next attempt. Exported + pure so the give-up / attempt-counting rule is
// unit-tested without a database.
export function claimAction(attempts: number): {
  action: "claim" | "give_up";
  nextAttempts: number;
} {
  if (attempts >= MAX_ATTEMPTS) return { action: "give_up", nextAttempts: attempts };
  return { action: "claim", nextAttempts: attempts + 1 };
}

// Pure failure decision. `attempts` is the post-claim count (tries so far), so:
// exhausted -> terminal "failed"; otherwise back to "pending" with a short,
// attempt-scaled backoff (1..4 min) — minutes, not the old hour, so a transient
// blip clears quickly.
export function nextFailedState(attempts: number): {
  status: JobStatus;
  delayMs: number;
} {
  if (attempts >= MAX_ATTEMPTS) return { status: "failed", delayMs: 0 };
  return {
    status: "pending",
    delayMs: Math.min(Math.max(attempts, 1), 5) * 60 * 1000,
  };
}

export async function enqueueJob(opts: {
  kind: JobKind;
  payload: Record<string, unknown>;
  runAfter: Date;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("jobs").insert({
    kind: opts.kind,
    payload: opts.payload,
    run_after: opts.runAfter.toISOString(),
    status: "pending",
  });
  if (error) throw error;
}

export async function cancelPendingJobs(
  kind: JobKind,
  matcher: (payload: Record<string, unknown>) => boolean,
): Promise<number> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("jobs")
    .select("id, payload")
    .eq("kind", kind)
    .eq("status", "pending");
  if (error) throw error;
  const toCancel = (data ?? [])
    .filter((j) => matcher((j.payload ?? {}) as Record<string, unknown>))
    .map((j) => j.id);
  if (toCancel.length === 0) return 0;
  const { error: e2 } = await sb
    .from("jobs")
    .update({ status: "done", last_error: "cancelled" })
    .in("id", toCancel);
  if (e2) throw e2;
  return toCancel.length;
}

export async function claimDueJobs(limit = 5): Promise<Job[]> {
  const sb = getServiceRoleSupabase();
  const nowIso = new Date().toISOString();
  // Candidates: PENDING jobs that are due, PLUS RUNNING jobs whose lease has
  // lapsed (their worker died mid-run — reclaim them so they're never stuck).
  // Either way run_after must be in the past. Oldest first; the
  // (status, run_after) index covers this query.
  const { data: candidates, error } = await sb
    .from("jobs")
    .select("id, attempts, status")
    .in("status", ["pending", "running"])
    .lte("run_after", nowIso)
    .order("run_after", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const claimed: Job[] = [];
  for (const cand of candidates ?? []) {
    const attempts = (cand.attempts as number) ?? 0;
    const priorStatus = cand.status as string;
    const decision = claimAction(attempts);
    if (decision.action === "give_up") {
      // Exhausted: stop retrying so it can never loop forever. Mark terminal,
      // guarding on the status we saw so a concurrent winner is never clobbered.
      await sb
        .from("jobs")
        .update({ status: "failed", last_error: "max_attempts_exhausted" })
        .eq("id", cand.id)
        .eq("status", priorStatus);
      continue;
    }
    // Atomic compare-and-swap claim: succeeds only if the row is STILL in the
    // status we read, so two overlapping cron runs can't both take one job. Set
    // the lease (run_after) and bump attempts in the same write.
    const { data: rows, error: e2 } = await sb
      .from("jobs")
      .update({
        status: "running",
        run_after: leaseUntil,
        attempts: decision.nextAttempts,
      })
      .eq("id", cand.id)
      .eq("status", priorStatus)
      .select("*");
    if (e2) throw e2;
    if (rows && rows[0]) claimed.push(rows[0] as Job);
  }
  return claimed;
}

export async function markJobDone(id: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb.from("jobs").update({ status: "done", last_error: null }).eq("id", id);
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("jobs")
    .select("attempts")
    .eq("id", id)
    .single();
  // `attempts` was already bumped at claim, so it reflects tries-so-far — do
  // NOT increment again here (the old code did, which together with the old
  // claim-time reset of attempts to 0 made the give-up cap unreachable). The
  // pure helper decides terminal-vs-retry + the short backoff.
  const attempts = (data?.attempts as number) ?? 0;
  const next = nextFailedState(attempts);
  await sb
    .from("jobs")
    .update({
      status: next.status,
      last_error: error.slice(0, 1000),
      run_after: new Date(Date.now() + next.delayMs).toISOString(),
    })
    .eq("id", id);
}
