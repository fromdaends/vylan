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

const MAX_ATTEMPTS = 3;

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

export async function claimDueJobs(limit = 25): Promise<Job[]> {
  const sb = getServiceRoleSupabase();
  // Two-step claim: select due IDs, then UPDATE ... WHERE id IN (...) ...
  // returning the rows. We accept the small race window in MVP since the
  // cron only runs every 15 minutes and we mark status='running' before
  // doing any work. Cron lock can come later if needed.
  const { data: candidates, error } = await sb
    .from("jobs")
    .select("id")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("run_after", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const ids = (candidates ?? []).map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: claimed, error: e2 } = await sb
    .from("jobs")
    .update({ status: "running", attempts: 0 })
    .in("id", ids)
    .eq("status", "pending")
    .select("*");
  if (e2) throw e2;
  return (claimed ?? []) as Job[];
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
  const attempts = ((data?.attempts as number) ?? 0) + 1;
  const status: JobStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  const nextRun = new Date(Date.now() + 60 * 60 * 1000 * attempts).toISOString();
  await sb
    .from("jobs")
    .update({
      status,
      attempts,
      last_error: error.slice(0, 1000),
      run_after: status === "pending" ? nextRun : new Date().toISOString(),
    })
    .eq("id", id);
}
