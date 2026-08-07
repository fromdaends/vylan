import type { SupabaseClient } from "@supabase/supabase-js";
import { trustedDocTypeCode } from "@/lib/filing/tokens";
import { DELETED_RETENTION_DAYS } from "./lifecycle";
import { rehomeSchedulesBeforeDelete } from "@/lib/billing/rehome-schedules";

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
  filesRehomed: number;
};

type ExpiredRow = {
  id: string;
  firm_id: string;
  // Where the engagement's surviving files re-home to. Every engagement has a
  // client; the files outlive the engagement AS that client's documents.
  client_id: string;
  title: string | null;
  deleted_at: string | null;
};

// Who asked for the permanent delete — the cron ("system") or an owner clicking
// "Delete forever" on a Recently-deleted row. Recorded in the durable purge log.
export type PurgeActor = { type: "system" } | { type: "user"; id: string };

// What the re-home reads off a document row. The two source tables share every
// column here except the AI trio + content_hash (uploaded_files only) and the
// timestamp name (uploaded_at vs created_at).
type DocRow = {
  storage_path: string | null;
  original_filename: string;
  display_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  manual_doc_type: string | null;
  browse_year: number | null;
  browse_category: string | null;
  folder_id: string | null;
  visibility: string | null;
  deleted_at: string | null;
  content_hash?: string | null;
  ai_classification?: string | null;
  ai_confidence?: number | null;
  uploaded_at?: string | null;
  created_at?: string | null;
};

const SHARED_DOC_COLUMNS =
  "storage_path, original_filename, display_name, mime_type, size_bytes, " +
  "manual_doc_type, browse_year, browse_category, folder_id, visibility, deleted_at";

// Per-table column lists — selecting a column a table doesn't have is an error,
// so the AI trio / content_hash / timestamp are added per source.
const DOC_SOURCES = [
  {
    table: "uploaded_files",
    columns: `${SHARED_DOC_COLUMNS}, content_hash, ai_classification, ai_confidence, uploaded_at`,
  },
  { table: "final_documents", columns: `${SHARED_DOC_COLUMNS}, created_at` },
] as const;

/**
 * Permanently delete ONE soft-deleted engagement — WITHOUT destroying the
 * client's files. Founder ruling (2026-08-04, after a real data loss): "when
 * you delete an engagement forever, you should not delete the files they
 * saved."
 *
 * So the flow is: re-home every live (not soft-deleted) uploaded_files /
 * final_documents row to the CLIENT level first — an imported_documents row
 * pointing at the SAME storage object, carrying the name / type / folder /
 * browse position the firm already gave it — and only then hard-delete the
 * engagement row and let the FK cascade clear the tables that reference it.
 * The storage objects of re-homed files are NOT touched; the only bytes
 * removed are those of files the firm had already binned itself (deleted_at
 * set), which the cascade is about to erase beyond restoring anyway.
 *
 * Order matters for failure safety: re-home, then the durable audit row, then
 * the row delete (rolling back the re-homed rows if it fails, so a retry can't
 * duplicate them), and storage removal LAST — once the engagement is gone, a
 * failed bucket remove merely leaks orphan bytes, which is the benign
 * direction; it must never fail a purge that already happened.
 *
 * Shared by the daily cron (below) and the owner's "Delete forever" action, so
 * the two can never drift on what "permanently deleted" means. Throws on
 * failure; the cron loop catches per row.
 */
export async function purgeOneEngagement(
  deps: Pick<PurgeDeps, "supabase" | "removeStorageObjects">,
  eng: ExpiredRow,
  actor: PurgeActor = { type: "system" },
): Promise<{ filesRemoved: number; filesRehomed: number }> {
  const { supabase, removeStorageObjects } = deps;

  // 1. Collect the engagement's documents from both tables — the client's
  //    uploads AND the firm's deliverables — and split them: live rows are
  //    re-homed, rows the firm already soft-deleted lose their bytes.
  const keep: DocRow[] = [];
  const binnedPaths: string[] = [];
  for (const source of DOC_SOURCES) {
    const { data, error } = await supabase
      .from(source.table)
      .select(source.columns)
      .eq("engagement_id", eng.id);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as DocRow[]) {
      const hasBytes =
        typeof row.storage_path === "string" && row.storage_path.length > 0;
      if (!hasBytes) continue; // nothing in the bucket to keep or remove
      if (row.deleted_at == null) keep.push(row);
      else binnedPaths.push(row.storage_path as string);
    }
  }

  // 2. Re-home the live files to the client: one imported_documents row per
  //    file, pointing at the SAME storage object. imported_documents has no
  //    engagement FK, so these rows survive the cascade — the file stays
  //    downloadable in the client's Files exactly where firm_documents'
  //    "imported" arm already looks.
  let rehomedIds: string[] = [];
  if (keep.length > 0) {
    const rows = keep.map((row) => ({
      firm_id: eng.firm_id,
      client_id: eng.client_id,
      import_run_id: null,
      storage_path: row.storage_path,
      original_filename: row.original_filename,
      display_name: row.display_name ?? null,
      mime_type: row.mime_type ?? null,
      size_bytes: row.size_bytes ?? null,
      content_hash: row.content_hash ?? null,
      // Provenance: which engagement this came from, readable after the
      // engagement row is gone. Never displayed today, but it's the answer to
      // "where did this file come from?" that the purge would otherwise erase.
      source_path: eng.title,
      // Folders are per-client (1100), so the assignment stays valid.
      folder_id: row.folder_id ?? null,
      visibility: row.visibility ?? "firm",
      // The file keeps its place in Browse: same year, same category, and the
      // doc type as the UI resolved it — a manual choice verbatim, else the
      // AI's answer when it cleared the shared trust threshold. Snapshotting
      // the AI answer into manual_doc_type is deliberate: imported_documents
      // has no AI columns, and nothing will ever re-classify this row.
      browse_year: row.browse_year ?? null,
      browse_category: row.browse_category ?? null,
      manual_doc_type:
        row.manual_doc_type ??
        trustedDocTypeCode(row.ai_classification, row.ai_confidence),
      imported_by: actor.type === "user" ? actor.id : null,
      // Keep the original timestamp so the client's Files chronology stays
      // true (both source columns are NOT NULL).
      created_at: row.uploaded_at ?? row.created_at,
    }));
    const { data: inserted, error: insErr } = await supabase
      .from("imported_documents")
      .insert(rows)
      .select("id");
    if (insErr) throw insErr;
    rehomedIds = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
  }

  // 3. Durable purge log: engagement_id = null so this row survives the
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
      files_rehomed: rehomedIds.length,
    },
  });

  // 3b. Move any live PAYMENT SCHEDULE off this engagement first.
  //
  //     Since work-repeat and pay-repeat became independent, one schedule can
  //     span a whole series while being pinned to whichever occurrence
  //     created it — usually the oldest, i.e. the first one purged. The
  //     cascade below would take the arrangement's billing and its entire
  //     charge ledger with it, silently: the client just stops being charged.
  //     Re-homing to a surviving occurrence keeps the money running; with no
  //     survivor the schedule is ended, which is honest and keeps the history.
  await rehomeSchedulesBeforeDelete(eng.id);

  // 4. Hard-delete the row; the FK cascade clears everything that references
  //    it. If THIS fails the re-homed rows are removed again before rethrowing
  //    — otherwise a retry would re-home the same files twice and the client's
  //    Files would show every document doubled.
  const { error: delErr } = await supabase
    .from("engagements")
    .delete()
    .eq("id", eng.id);
  if (delErr) {
    if (rehomedIds.length > 0) {
      await supabase.from("imported_documents").delete().in("id", rehomedIds);
    }
    throw delErr;
  }

  // 5. Remove the bytes of files the firm had already binned — and ONLY
  //    those. A path a live file still points at is never removed, even if a
  //    binned row shares it. Removal failure is swallowed: the purge already
  //    happened, and orphan bytes are the benign direction.
  const keptPaths = new Set(keep.map((r) => r.storage_path));
  const toRemove = binnedPaths.filter((p) => !keptPaths.has(p));
  let filesRemoved = 0;
  if (toRemove.length > 0) {
    try {
      await removeStorageObjects(toRemove);
      filesRemoved = toRemove.length;
    } catch {
      filesRemoved = 0;
    }
  }

  return { filesRemoved, filesRehomed: rehomedIds.length };
}

// Permanently deletes engagements that have been soft-deleted longer than the
// retention window. The DB rows go (the FK cascade clears request_items /
// uploaded_files / jobs / activity_log), but the client's FILES do not: live
// documents are re-homed to imported_documents first (see purgeOneEngagement),
// and only files the firm had already binned lose their storage bytes.
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
    .select("id, firm_id, client_id, title, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoffIso);
  if (error) throw error;

  const purged: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let filesRemoved = 0;
  let filesRehomed = 0;

  for (const eng of (expired ?? []) as ExpiredRow[]) {
    try {
      const res = await purgeOneEngagement(deps, eng);
      filesRemoved += res.filesRemoved;
      filesRehomed += res.filesRehomed;
      purged.push(eng.id);
    } catch (e) {
      failed.push({ id: eng.id, error: (e as Error).message ?? String(e) });
    }
  }

  return { purged, failed, filesRemoved, filesRehomed };
}
