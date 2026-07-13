// Data layer for "final documents" (migration 0620): completed deliverables the
// accountant uploads to return to the client (the finished return, statements,
// letters).
//
// Accountant reads/writes go through the RLS-scoped session client (firm members
// see only their own firm's rows). The client portal reads them via the service
// role (after the /r/[token] + /api/portal/deliverables routes validate the magic
// token). Everything degrades gracefully before migration 0620 is applied to the
// remote DB (dev uses remote Supabase): a missing table is treated as "no final
// documents yet" so the UI never hard-errors.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";

export type FinalDocument = {
  id: string;
  firm_id: string;
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  display_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
};

// PGRST205 = table not in schema cache (migration not applied), 42P01 = undefined
// table; the message match is a belt-and-suspenders for the same condition.
function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    /final_documents/i.test(err.message ?? "")
  );
}

const COLUMNS =
  "id, firm_id, engagement_id, storage_path, original_filename, display_name, mime_type, size_bytes, uploaded_by_user_id, created_at";

// Accountant-side list (RLS-scoped). Newest first. Degrades to [] pre-0620.
export async function listFinalDocumentsForEngagement(
  engagementId: string,
): Promise<FinalDocument[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("final_documents")
    .select(COLUMNS)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[final-documents] list failed:", error);
    }
    return [];
  }
  return (data as FinalDocument[]) ?? [];
}

export type CreateFinalDocumentInput = {
  firm_id: string;
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  display_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_by_user_id: string | null;
};

// Insert through the RLS session client so the firm_id is enforced by the
// with-check policy. Returns null on failure (caller cleans up the storage
// object it already wrote).
export async function createFinalDocument(
  input: CreateFinalDocumentInput,
): Promise<FinalDocument | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("final_documents")
    .insert({
      firm_id: input.firm_id,
      engagement_id: input.engagement_id,
      storage_path: input.storage_path,
      original_filename: input.original_filename,
      display_name: input.display_name ?? null,
      mime_type: input.mime_type ?? null,
      size_bytes: input.size_bytes ?? null,
      uploaded_by_user_id: input.uploaded_by_user_id,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    console.error("[final-documents] create failed:", error);
    return null;
  }
  return data as FinalDocument;
}

// Delete one final document (RLS-scoped: only the owning firm can). Returns the
// storage_path so the caller can remove the underlying object. Null if not found
// / not permitted.
export async function deleteFinalDocument(
  id: string,
): Promise<{ storage_path: string } | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("final_documents")
    .delete()
    .eq("id", id)
    .select("storage_path")
    .maybeSingle();
  if (error) {
    console.error("[final-documents] delete failed:", error);
    return null;
  }
  if (!data) return null;
  return { storage_path: data.storage_path as string };
}

// ── Service-role reads for the unauthenticated client portal ────────────────
// Callers MUST have already validated the magic token + engagement match.

// The list the portal renders. Oldest first (delivered-in-order reads best).
export async function listFinalDocumentsForEngagementSR(
  engagementId: string,
): Promise<FinalDocument[]> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("final_documents")
    .select(COLUMNS)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[final-documents] listSR failed:", error);
    }
    return [];
  }
  return (data as FinalDocument[]) ?? [];
}

// One final document by id, for the portal download route. Returns just what the
// route needs to authorize (engagement_id) and stream (storage_path, filename,
// mime). Null if missing.
export async function getFinalDocumentForDownloadSR(id: string): Promise<{
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
} | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("final_documents")
    .select("engagement_id, storage_path, original_filename, mime_type")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[final-documents] getForDownloadSR failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    engagement_id: data.engagement_id as string,
    storage_path: data.storage_path as string,
    original_filename: data.original_filename as string,
    mime_type: (data.mime_type as string | null) ?? null,
  };
}
