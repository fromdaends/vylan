// Permanently erasing documents whose 30-day recycle-bin window has expired.
//
// This is the ONLY place in the product that hard-deletes a document the user
// put in the bin. Everything the accountant can click is a soft delete; the
// erase happens here, later, on a clock.
//
// Ordering is deliberate and matches lib/engagements/purge.ts: the storage
// object goes first, best-effort, then the row. A missing object must not block
// erasing the row (the row is what the product reads), and a row erased while
// its bytes survive is a private document with no owner and nothing pointing at
// it — strictly worse.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";

/** Matches the engagements recycle bin (0139) — one recovery window across the
 * product, so "deleted" means the same thing everywhere. */
export const DOCUMENT_RETENTION_DAYS = 30;

// Bounded per run: this shares the cron with the job queue and the two
// backfills, and a firm that bulk-deleted ten thousand files must not starve
// the reminders queued behind it. The leftovers are picked up next run.
const BATCH = 200;

export type PurgeResult = {
  scanned: number;
  purged: number;
  failed: number;
  unavailable?: boolean;
};

type Purgeable = { table: string; id: string; storage_path: string | null };

/**
 * Erase expired soft-deleted documents across all three document tables.
 *
 * Service role: this is a cron with no session, and 1090's RLS makes these rows
 * invisible to normal reads by design — a cron that could not see them could
 * never purge them.
 */
export async function purgeExpiredDeletedDocuments(
  retentionDays = DOCUMENT_RETENTION_DAYS,
): Promise<PurgeResult> {
  const sb = getServiceRoleSupabase();
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const tables = ["uploaded_files", "final_documents", "imported_documents"];
  const doomed: Purgeable[] = [];

  for (const table of tables) {
    const { data, error } = await sb
      .from(table)
      .select("id, storage_path")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(BATCH);
    if (error) {
      // 1070/1090 not applied here — nothing to purge, and saying so is more
      // useful than a stack trace in a cron log.
      if (doomed.length === 0 && table === tables[0]) {
        return { scanned: 0, purged: 0, failed: 0, unavailable: true };
      }
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; storage_path: string | null }>) {
      doomed.push({ table, id: row.id, storage_path: row.storage_path });
    }
  }

  let purged = 0;
  let failed = 0;
  for (const row of doomed) {
    if (row.storage_path) {
      try {
        await sb.storage.from(BUCKET).remove([row.storage_path]);
      } catch (e) {
        // Best effort by design: an object that is already gone, or a transient
        // storage error, must not strand the row in the bin forever.
        console.warn("[files/purge] storage delete failed:", row.storage_path, e);
      }
    }
    const { error } = await sb.from(row.table).delete().eq("id", row.id);
    if (error) {
      console.error("[files/purge] row delete failed:", row.table, row.id, error.message);
      failed++;
      continue;
    }
    purged++;
  }

  return { scanned: doomed.length, purged, failed };
}
