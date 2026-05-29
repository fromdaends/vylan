import type { SupabaseClient } from "@supabase/supabase-js";
import { DELETED_RETENTION_DAYS } from "./lifecycle";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeDeps = {
  // Service-role client — the cron has no user session, so RLS is bypassed.
  supabase: SupabaseClient;
  // Removes file objects from the storage bucket. Injected so unit tests never
  // touch real storage.
  removeStorageObjects: (paths: string[]) => Promise<void>;
  // Injected so tests are deterministic (no Date.now()).
  nowMs: number;
  retentionDays?: number;
};

export type PurgeResult = {
  purged: string[];
  failed: { id: string; error: string }[];
  filesRemoved: number;
};

type ExpiredRow = {
  id: string;
  firm_id: string;
  title: string | null;
  deleted_at: string | null;
};

// Permanently deletes engagements that have been soft-deleted longer than the
// retention window — both their DB rows (the FK cascade clears request_items /
// uploaded_files / jobs / activity_log) AND their files in storage (the cascade
// does NOT touch bucket objects, so we remove those explicitly first).
//
// Called only by the daily purge cron. The UI never hard-deletes — its "delete"
// is a recoverable soft-delete (deleted_at). One bad row doesn't abort the
// batch: failures are collected and returned so the rest still get purged.
export async function purgeExpiredDeletedEngagements(
  deps: PurgeDeps,
): Promise<PurgeResult> {
  const { supabase, removeStorageObjects, nowMs } = deps;
  const retentionDays = deps.retentionDays ?? DELETED_RETENTION_DAYS;
  const cutoffIso = new Date(nowMs - retentionDays * DAY_MS).toISOString();

  const { data: expired, error } = await supabase
    .from("engagements")
    .select("id, firm_id, title, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoffIso);
  if (error) throw error;

  const purged: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let filesRemoved = 0;

  for (const eng of (expired ?? []) as ExpiredRow[]) {
    try {
      // 1. Remove storage objects first — the DB cascade won't.
      const { data: files, error: filesErr } = await supabase
        .from("uploaded_files")
        .select("storage_path")
        .eq("engagement_id", eng.id);
      if (filesErr) throw filesErr;
      const paths = ((files ?? []) as { storage_path: string | null }[])
        .map((f) => f.storage_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (paths.length > 0) {
        await removeStorageObjects(paths);
        filesRemoved += paths.length;
      }

      // 2. Durable purge log: engagement_id = null so this row survives the
      //    cascade delete we're about to run — keeps the audit trail even
      //    though the engagement row is gone.
      await supabase.from("activity_log").insert({
        firm_id: eng.firm_id,
        engagement_id: null,
        actor_type: "system",
        actor_id: null,
        action: "engagement_purged",
        metadata: {
          engagement_id: eng.id,
          title: eng.title,
          deleted_at: eng.deleted_at,
        },
      });

      // 3. Hard-delete the row; the FK cascade clears everything that
      //    references it.
      const { error: delErr } = await supabase
        .from("engagements")
        .delete()
        .eq("id", eng.id);
      if (delErr) throw delErr;

      purged.push(eng.id);
    } catch (e) {
      failed.push({ id: eng.id, error: (e as Error).message ?? String(e) });
    }
  }

  return { purged, failed, filesRemoved };
}
