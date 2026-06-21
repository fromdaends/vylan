// QuickBooks cache sync — Stage 2, Phase 4.
//
// Live-reads the firm's four reference lists and replaces the local cache, then
// records the sync state. Runs server-side via the background job
// (jobs.kind = 'sync_quickbooks') so a heavy multi-list pull never blocks a
// request/render. READ-ONLY against QuickBooks.

import { readQuickbooksLists } from "@/lib/quickbooks/read";
import {
  setFirmSyncState,
  replaceCachedEntity,
} from "@/lib/db/quickbooks-cache";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";

export type SyncResult = { ok: boolean; detail: string };

// Enqueue a cache sync for a firm, de-duplicating any already-pending sync (so
// rapid triggers can't pile up) and optimistically marking the connection
// 'syncing'. Best-effort: never throws (callers are connect/refresh/self-heal).
export async function enqueueQuickbooksSync(firmId: string): Promise<void> {
  try {
    await cancelPendingJobs(
      "sync_quickbooks",
      (p) => p.firmId === firmId,
    );
    await enqueueJob({
      kind: "sync_quickbooks",
      payload: { firmId },
      runAfter: new Date(),
    });
    await setFirmSyncState(firmId, { status: "syncing" });
  } catch (e) {
    console.error("[quickbooks] enqueueQuickbooksSync failed:", e);
  }
}

// Sync one firm's lists into the cache. Marks status 'syncing' -> 'ok'/'error'.
// A list that failed to load live (null) is LEFT as-is in the cache (not wiped),
// and the overall result is a partial error so the user can retry.
export async function syncQuickbooksLists(firmId: string): Promise<SyncResult> {
  await setFirmSyncState(firmId, { status: "syncing" });

  const result = await readQuickbooksLists(firmId);
  if (!result.ok) {
    await setFirmSyncState(firmId, { status: "error", error: result.reason });
    return { ok: false, detail: result.reason };
  }

  const syncedAt = new Date().toISOString();
  const lists = result.data;
  const failed: string[] = [];
  try {
    if (lists.accounts)
      await replaceCachedEntity(firmId, "accounts", lists.accounts, syncedAt);
    else failed.push("accounts");
    if (lists.vendors)
      await replaceCachedEntity(firmId, "vendors", lists.vendors, syncedAt);
    else failed.push("vendors");
    if (lists.customers)
      await replaceCachedEntity(firmId, "customers", lists.customers, syncedAt);
    else failed.push("customers");
    if (lists.taxCodes)
      await replaceCachedEntity(firmId, "taxCodes", lists.taxCodes, syncedAt);
    else failed.push("taxCodes");
  } catch (e) {
    await setFirmSyncState(firmId, {
      status: "error",
      error: `cache_write: ${(e as Error).message ?? String(e)}`.slice(0, 500),
    });
    return { ok: false, detail: "cache_write_failed" };
  }

  if (failed.length > 0) {
    // Partial: some lists failed live. Do NOT stamp lastSyncedAt — keep the last
    // CLEAN sync time so /lists serves the last complete cache (or live) instead
    // of a list with a hole. The cron retries this job to complete it.
    await setFirmSyncState(firmId, {
      status: "error",
      error: `partial: ${failed.join(",")}`,
    });
    return { ok: false, detail: `partial:${failed.join(",")}` };
  }

  await setFirmSyncState(firmId, {
    status: "ok",
    error: null,
    lastSyncedAt: syncedAt,
  });
  return { ok: true, detail: "ok" };
}

// Job handler (kind 'sync_quickbooks'). Never throws — syncQuickbooksLists records
// any failure in the sync state, and we return a detail for the cron log.
export async function processSyncQuickbooksJob(
  payload: Record<string, unknown>,
): Promise<SyncResult> {
  const firmId = typeof payload.firmId === "string" ? payload.firmId : null;
  if (!firmId) return { ok: false, detail: "no_firm_id" };
  try {
    return await syncQuickbooksLists(firmId);
  } catch (e) {
    return { ok: false, detail: (e as Error).message ?? String(e) };
  }
}
