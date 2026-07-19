// QuickBooks cache sync — Stage 2, Phase 4; per-client since Phase 3b.
//
// Live-reads a connection's four reference lists and replaces the local cache,
// then records the sync state. Scoped to a client via `clientId` (undefined/null
// = the legacy firm-level connection; a uuid = that client's connection). Runs
// server-side via the background job (jobs.kind = 'sync_quickbooks') so a heavy
// multi-list pull never blocks a request/render. READ-ONLY against QuickBooks.

import { readQuickbooksLists } from "@/lib/quickbooks/read";
import {
  setFirmSyncState,
  replaceCachedEntity,
} from "@/lib/db/quickbooks-cache";
import {
  isMissingSchema,
  updateFirmQuickbooksCompanyCountry,
} from "@/lib/db/quickbooks";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { fetchCompanyProfile } from "@/lib/quickbooks/client";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";

// Best-effort self-heal: populate company_country for a connection that predates
// the tax-line feature (or pre-0470), so posting can decide whether to send the
// non-US GlobalTaxCalculation without a reconnect. Only does a CompanyInfo read
// when the country isn't already known; never throws.
async function backfillCompanyCountry(
  firmId: string,
  clientId?: string | null,
): Promise<void> {
  try {
    const ctx = await getQuickbooksReadContext(firmId, clientId);
    if (!ctx || ctx.companyCountry) return; // not connected, or already known
    const profile = await fetchCompanyProfile(
      ctx.accessToken,
      ctx.realmId,
      ctx.environment,
    );
    await updateFirmQuickbooksCompanyCountry(firmId, profile.country, clientId);
  } catch (e) {
    console.warn("[quickbooks] backfillCompanyCountry failed:", e);
  }
}

export type SyncResult = { ok: boolean; detail: string };

// Enqueue a cache sync for a connection, de-duplicating any already-pending sync
// for the SAME (firm, client) — so rapid triggers can't pile up, but one client's
// sync never cancels another's — and optimistically marking it 'syncing'.
// Best-effort: never throws (callers are connect/refresh/self-heal).
export async function enqueueQuickbooksSync(
  firmId: string,
  clientId?: string | null,
): Promise<void> {
  const scope = clientId ?? null;
  try {
    await cancelPendingJobs(
      "sync_quickbooks",
      (p) => p.firmId === firmId && (p.clientId ?? null) === scope,
    );
    await enqueueJob({
      kind: "sync_quickbooks",
      payload: { firmId, clientId: scope },
      runAfter: new Date(),
    });
    await setFirmSyncState(firmId, { status: "syncing" }, clientId);
  } catch (e) {
    console.error("[quickbooks] enqueueQuickbooksSync failed:", e);
  }
}

// Sync one connection's lists into the cache. Marks status 'syncing' ->
// 'ok'/'error'. A list that failed to load live (null) is LEFT as-is in the cache
// (not wiped), and the overall result is a partial error so the user can retry.
export async function syncQuickbooksLists(
  firmId: string,
  clientId?: string | null,
): Promise<SyncResult> {
  await setFirmSyncState(firmId, { status: "syncing" }, clientId);

  // Stamp the sync at run START — BEFORE fetching the lists — so the upsert-then-
  // prune in replaceCachedEntity (which deletes rows with synced_at < syncedAt)
  // can't delete an entity created INLINE during this sync. Such a row is stamped
  // `now` (> run-start) by upsertCachedEntityRow and isn't in this sync's fetched
  // snapshot, so a syncedAt captured AFTER the fetch would wrongly prune it and
  // leave the just-created vendor un-postable until the next sync. Genuinely-
  // removed rows carry an older previous-sync stamp and still prune correctly.
  const syncedAt = new Date().toISOString();

  const result = await readQuickbooksLists(firmId, clientId);
  if (!result.ok) {
    await setFirmSyncState(
      firmId,
      { status: "error", error: result.reason },
      clientId,
    );
    return { ok: false, detail: result.reason };
  }

  const lists = result.data;
  const failed: string[] = [];
  try {
    if (lists.accounts)
      await replaceCachedEntity(
        firmId,
        "accounts",
        lists.accounts,
        syncedAt,
        clientId,
      );
    else failed.push("accounts");
    if (lists.vendors)
      await replaceCachedEntity(
        firmId,
        "vendors",
        lists.vendors,
        syncedAt,
        clientId,
      );
    else failed.push("vendors");
    if (lists.customers)
      await replaceCachedEntity(
        firmId,
        "customers",
        lists.customers,
        syncedAt,
        clientId,
      );
    else failed.push("customers");
    if (lists.taxCodes)
      await replaceCachedEntity(
        firmId,
        "taxCodes",
        lists.taxCodes,
        syncedAt,
        clientId,
      );
    else failed.push("taxCodes");
    // Items (0460) sync best-effort + strictly additive: before the migration is
    // applied the table doesn't exist (skip silently), and a failed items read
    // (null) must NOT make the whole sync "partial" — the four core lists are
    // what gate lastSyncedAt. So items never push to `failed`.
    if (lists.items) {
      try {
        await replaceCachedEntity(
          firmId,
          "items",
          lists.items,
          syncedAt,
          clientId,
        );
      } catch (e) {
        if (!isMissingSchema(e as { code?: string; message?: string })) throw e;
      }
    }
  } catch (e) {
    await setFirmSyncState(
      firmId,
      {
        status: "error",
        error: `cache_write: ${(e as Error).message ?? String(e)}`.slice(0, 500),
      },
      clientId,
    );
    return { ok: false, detail: "cache_write_failed" };
  }

  if (failed.length > 0) {
    // Partial: some lists failed live. Do NOT stamp lastSyncedAt — keep the last
    // CLEAN sync time so /lists serves the last complete cache (or live) instead
    // of a list with a hole. The cron retries this job to complete it.
    await setFirmSyncState(
      firmId,
      { status: "error", error: `partial: ${failed.join(",")}` },
      clientId,
    );
    return { ok: false, detail: `partial:${failed.join(",")}` };
  }

  await setFirmSyncState(
    firmId,
    { status: "ok", error: null, lastSyncedAt: syncedAt },
    clientId,
  );
  // Self-heal the company country (best-effort, no-op once known) so tax-line
  // posting can branch US vs non-US. Off the critical path — failures are ignored.
  await backfillCompanyCountry(firmId, clientId);
  return { ok: true, detail: "ok" };
}

// Job handler (kind 'sync_quickbooks'). Never throws — syncQuickbooksLists records
// any failure in the sync state, and we return a detail for the cron log.
export async function processSyncQuickbooksJob(
  payload: Record<string, unknown>,
): Promise<SyncResult> {
  const firmId = typeof payload.firmId === "string" ? payload.firmId : null;
  if (!firmId) return { ok: false, detail: "no_firm_id" };
  // clientId scopes the sync to one client's connection; absent/null = the legacy
  // firm-level connection (backward compatible with jobs enqueued pre-3b).
  const clientId =
    typeof payload.clientId === "string" ? payload.clientId : null;
  try {
    return await syncQuickbooksLists(firmId, clientId);
  } catch (e) {
    return { ok: false, detail: (e as Error).message ?? String(e) };
  }
}
