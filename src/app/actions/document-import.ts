"use server";

// The import wizard's server side.
//
// Shape: the BROWSER uploads bytes straight to storage via short-lived signed
// URLs, and calls back here to record each file. That mirrors the portal's
// existing direct-to-storage flow and exists for the same reason — pushing
// thousands of files through server actions would hit platform body limits and
// serialize an operation that is naturally parallel.
//
// CONSEQUENCE WORTH STATING PLAINLY: for a LOCAL folder import, the file
// handles live in the browser tab. If that tab closes mid-import, the import
// stops. The run row records exactly what landed, so nothing is lost or
// duplicated and the firm can re-drop the same folder to finish (already
// imported files are skipped as duplicates) — but this cannot be a
// "survives a page reload" background job the way a cloud-provider import
// will be, and the UI says so rather than implying otherwise.

import { revalidatePath } from "next/cache";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";
import { createUploadUrl } from "@/lib/storage";
import { safeStorageName } from "@/lib/files/safe-name";
import { yearFromSourcePath } from "@/lib/files/axes";

export type StartImportResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

/** Open an import run. One row per import the firm starts. */
export async function startImportRunAction(input: {
  totalCount: number;
}): Promise<StartImportResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();

  const service = getServiceRoleSupabase();
  const { data, error } = await service
    .from("document_import_runs")
    .insert({
      firm_id: firm.id,
      source: "local",
      status: "running",
      total_count: Math.max(0, input.totalCount | 0),
      started_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logUserActivity(firm.id, null, "documents_imported", {
    phase: "started",
    run_id: data.id,
    total: input.totalCount,
    source: "local",
  });
  return { ok: true, runId: data.id as string };
}

export type UploadSlot =
  | { ok: true; path: string; signedUrl: string; token: string }
  | { ok: false; error: string };

/**
 * Reserve a storage location for one imported file and hand back a signed URL
 * the browser PUTs to.
 *
 * The CLIENT is validated here, not trusted from the browser: an import maps
 * folders to clients, and a mapping the caller cannot actually see must not
 * become a document filed under that client. The read goes through RLS, so the
 * database answers that question.
 */
export async function createImportUploadSlotAction(input: {
  runId: string;
  clientId: string;
  filename: string;
}): Promise<UploadSlot> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };
  if (!input.runId || !input.clientId || !input.filename) {
    return { ok: false, error: "invalid" };
  }

  const sb = await getServerSupabase();
  const { data: client } = await sb
    .from("clients")
    .select("id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "client_not_found" };

  const uuid = crypto.randomUUID();
  const path = `firms/${firm.id}/imports/${input.runId}/${uuid}-${safeStorageName(input.filename)}`;
  try {
    const { signedUrl, token } = await createUploadUrl(path);
    return { ok: true, path, signedUrl, token };
  } catch {
    return { ok: false, error: "sign_failed" };
  }
}

export type RecordResult =
  | { ok: true; skipped?: "duplicate" }
  | { ok: false; error: string };

/**
 * Record one uploaded file as an imported document.
 *
 * DUPLICATE HANDLING: a file whose content hash already exists for this client
 * is skipped and reported, not stored twice. That matters because re-dropping a
 * folder is the documented way to finish an interrupted import — without this,
 * finishing an import would double every file that had already landed.
 *
 * Imports deliberately arrive UNCLASSIFIED (the founder's call): no AI pass, so
 * no cost, and the accountant sorts them with bulk Move. The one thing inferred
 * is the YEAR, read from the folder path — plain string parsing, no model.
 */
export async function recordImportedFileAction(input: {
  runId: string;
  clientId: string;
  storagePath: string;
  originalFilename: string;
  sourcePath: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
}): Promise<RecordResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };

  const sb = await getServerSupabase();
  const { data: client } = await sb
    .from("clients")
    .select("id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "client_not_found" };

  const service = getServiceRoleSupabase();

  if (input.contentHash) {
    // Against BOTH tables: the same document may already be here because the
    // client sent it through the portal, not only because a previous import
    // attempt stored it.
    const { data: dupImport } = await service
      .from("imported_documents")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("content_hash", input.contentHash)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (dupImport) return { ok: true, skipped: "duplicate" };
  }

  const { error } = await service.from("imported_documents").insert({
    firm_id: firm.id,
    client_id: input.clientId,
    import_run_id: input.runId,
    storage_path: input.storagePath,
    original_filename: input.originalFilename,
    display_name: null,
    mime_type: input.mimeType || null,
    size_bytes: input.sizeBytes,
    content_hash: input.contentHash,
    source_path: input.sourcePath,
    // The firm's own folder names are their existing organisation — reading a
    // year out of them means confirming a guess instead of typing from scratch.
    browse_year: yearFromSourcePath(input.sourcePath),
    browse_category: null,
    imported_by: (await sb.auth.getUser()).data.user?.id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Close the run and record the outcome. */
export async function finishImportRunAction(input: {
  runId: string;
  imported: number;
  skipped: number;
  failed: number;
  failures: { name: string; reason: string }[];
}): Promise<{ ok: boolean }> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false };
  const service = getServiceRoleSupabase();
  await service
    .from("document_import_runs")
    .update({
      status: input.failed > 0 ? "failed" : "complete",
      imported_count: input.imported,
      skipped_count: input.skipped,
      failed_count: input.failed,
      // Bounded: a run where everything failed must not write an unbounded blob
      // into the row.
      failures: (input.failures ?? []).slice(0, 100),
      finished_at: new Date().toISOString(),
    })
    .eq("id", input.runId);

  await logUserActivity(firm.id, null, "documents_imported", {
    phase: "finished",
    run_id: input.runId,
    imported: input.imported,
    skipped: input.skipped,
    failed: input.failed,
    source: "local",
  });
  revalidatePath("/files");
  return { ok: true };
}
