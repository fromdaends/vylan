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

// Who asked for the permanent delete — the cron ("system") or an owner clicking
// "Delete forever" on a Recently-deleted row. Recorded in the durable purge log.
export type PurgeActor = { type: "system" } | { type: "user"; id: string };

/**
 * Permanently delete ONE soft-deleted engagement: storage objects first (the FK
 * cascade clears every table that references the row, but never touches bucket
 * objects), then a durable engagement_id-null audit row, then the row itself.
 *
 * Shared by the daily cron (below) and the owner's "Delete forever" action, so
 * the two can never drift on what "permanently deleted" means. Throws on
 * failure; the cron loop catches per row.
 *
 * Returns how many storage objects were removed.
 */
export async function purgeOneEngagement(
  deps: Pick<PurgeDeps, "supabase" | "removeStorageObjects">,
  eng: ExpiredRow,
  actor: PurgeActor = { type: "system" },
): Promise<{ filesRemoved: number }> {
  const { supabase, removeStorageObjects } = deps;

  // 1. Remove storage objects first — the DB cascade won't. Both the client's
  //    uploads AND the firm's deliverables (final_documents) live in the
  //    bucket; the cron used to collect only uploaded_files, quietly leaking
  //    every deliverable's bytes on purge.
  const paths: string[] = [];
  for (const table of ["uploaded_files", "final_documents"] as const) {
    const { data: files, error: filesErr } = await supabase
      .from(table)
      .select("storage_path")
      .eq("engagement_id", eng.id);
    if (filesErr) throw filesErr;
    for (const f of (files ?? []) as { storage_path: string | null }[]) {
      if (typeof f.storage_path === "string" && f.storage_path.length > 0) {
        paths.push(f.storage_path);
      }
    }
  }
  if (paths.length > 0) {
    await removeStorageObjects(paths);
  }

  // 2. Durable purge log: engagement_id = null so this row survives the
  //    cascade delete we're about to run — keeps the audit trail even
  //    though the engagement row is gone.
  await supabase.from("activity_log").insert({
    firm_id: eng.firm_id,
    engagement_id: null,
    actor_type: actor.type,
    actor_id: actor.type === "user" ? actor.id : null,
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

  return { filesRemoved: paths.length };
}

// Permanently deletes engagements that have been soft-deleted longer than the
// retention window — both their DB rows (the FK cascade clears request_items /
// uploaded_files / jobs / activity_log) AND their files in storage (the cascade
// does NOT touch bucket objects, so we remove those explicitly first).
//
// Called by the daily purge cron. The UI's "delete" is a recoverable
// soft-delete (deleted_at); the only UI hard-delete is the owner's explicit
// "Delete forever" on an already-soft-deleted row, which goes through
// purgeOneEngagement above. One bad row doesn't abort the batch: failures are
// collected and returned so the rest still get purged.
export async function purgeExpiredDeletedEngagements(
  deps: PurgeDeps,
): Promise<PurgeResult> {
  const { supabase, nowMs } = deps;
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
      const res = await purgeOneEngagement(deps, eng);
      filesRemoved += res.filesRemoved;
      purged.push(eng.id);
    } catch (e) {
      failed.push({ id: eng.id, error: (e as Error).message ?? String(e) });
    }
  }

  return { purged, failed, filesRemoved };
}
