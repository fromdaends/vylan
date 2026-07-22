// Xero cache sync — Phase 2 (per client).
//
// Live-reads a client's Xero organisation reference lists and replaces the local
// cache, recording sync state on the connection row. Runs server-side via the
// background job (jobs.kind = 'sync_xero') so a heavy multi-list pull never
// blocks a request/render. READ-ONLY against Xero. Mirrors lib/quickbooks/sync.ts
// but always per-client (no firm-level scope).

import { readXeroRows } from "@/lib/xero/read";
import {
  setXeroSyncState,
  replaceCachedXeroEntity,
} from "@/lib/db/xero-cache";
import { isMissingXeroSchema } from "@/lib/db/xero";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";

export type XeroSyncResult = { ok: boolean; detail: string };

// Enqueue a cache sync for a client's connection, de-duplicating any pending
// sync for the SAME (firm, client) so rapid triggers can't pile up (but one
// client's sync never cancels another's), and optimistically marking 'syncing'.
// Best-effort: never throws (callers are connect/reconnect).
export async function enqueueXeroSync(
  firmId: string,
  clientId: string,
): Promise<void> {
  try {
    await cancelPendingJobs(
      "sync_xero",
      (p) => p.firmId === firmId && p.clientId === clientId,
    );
    await enqueueJob({
      kind: "sync_xero",
      payload: { firmId, clientId },
      runAfter: new Date(),
    });
    await setXeroSyncState(firmId, clientId, { status: "syncing" });
  } catch (e) {
    console.error("[xero] enqueueXeroSync failed:", e);
  }
}

// Sync one client's Xero lists into the cache. 'syncing' → 'ok'/'error'. A list
// that failed to load live (null) is LEFT as-is in the cache (not wiped) and
// makes the result a partial error so the cron retries; the last CLEAN
// lastSyncedAt is preserved on a partial.
export async function syncXeroLists(
  firmId: string,
  clientId: string,
): Promise<XeroSyncResult> {
  await setXeroSyncState(firmId, clientId, { status: "syncing" });

  // Stamp BEFORE the fetch so the upsert-then-prune can't delete a row created
  // inline after this run started (same reasoning as the QBO sync).
  const syncedAt = new Date().toISOString();

  const result = await readXeroRows(firmId, clientId);
  if (!result.ok) {
    await setXeroSyncState(firmId, clientId, {
      status: "error",
      error: result.reason,
    });
    return { ok: false, detail: result.reason };
  }

  const { rows } = result;
  const failed: string[] = [];
  try {
    if (rows.accounts)
      await replaceCachedXeroEntity(firmId, clientId, "accounts", rows.accounts, syncedAt);
    else failed.push("accounts");
    if (rows.contacts)
      await replaceCachedXeroEntity(firmId, clientId, "contacts", rows.contacts, syncedAt);
    else failed.push("contacts");
    if (rows.taxRates)
      await replaceCachedXeroEntity(firmId, clientId, "taxRates", rows.taxRates, syncedAt);
    else failed.push("taxRates");
    // Items are best-effort + additive: a failed items read must not make the
    // whole sync partial (the three core lists gate lastSyncedAt).
    if (rows.items) {
      try {
        await replaceCachedXeroEntity(firmId, clientId, "items", rows.items, syncedAt);
      } catch (e) {
        if (!isMissingXeroSchema(e as { code?: string; message?: string })) throw e;
      }
    }
  } catch (e) {
    await setXeroSyncState(firmId, clientId, {
      status: "error",
      error: `cache_write: ${(e as Error).message ?? String(e)}`.slice(0, 500),
    });
    return { ok: false, detail: "cache_write_failed" };
  }

  if (failed.length > 0) {
    await setXeroSyncState(firmId, clientId, {
      status: "error",
      error: `partial: ${failed.join(",")}`,
    });
    return { ok: false, detail: `partial:${failed.join(",")}` };
  }

  await setXeroSyncState(firmId, clientId, {
    status: "ok",
    error: null,
    lastSyncedAt: syncedAt,
  });
  return { ok: true, detail: "ok" };
}

// Job handler (kind 'sync_xero'). Never throws — syncXeroLists records failures
// in the sync state; we return a detail for the cron log.
export async function processSyncXeroJob(
  payload: Record<string, unknown>,
): Promise<XeroSyncResult> {
  const firmId = typeof payload.firmId === "string" ? payload.firmId : null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId : null;
  if (!firmId || !clientId) return { ok: false, detail: "no_firm_or_client_id" };
  try {
    return await syncXeroLists(firmId, clientId);
  } catch (e) {
    return { ok: false, detail: (e as Error).message ?? String(e) };
  }
}
