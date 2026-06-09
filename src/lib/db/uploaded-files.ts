import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import type { UsabilityVerdict } from "@/lib/ai/usability";

export type UploadedFile = {
  id: string;
  request_item_id: string;
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  ai_classification: string | null;
  ai_confidence: number | null;
  ai_extracted_fields: Record<string, unknown> | null;
  // Phase 1+2: structured AI usability verdict (null until classified
  // or when the model output was malformed).
  ai_usability: UsabilityVerdict | null;
  // Phase 3: true if the system actually auto-rejected this upload.
  // (Even when true, the file stays in storage — accountants can
  // override via Phase 5's UI.)
  ai_rejected: boolean;
  // Per-file accountant review (migration 0240). Each file carries its OWN
  // decision; the parent item's status is a roll-up of these (deriveItemStatus).
  review_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
  // Duplicate detection (migration 0270). content_hash is the SHA-256 of the
  // stored bytes; is_duplicate marks an exact-content re-upload; the earlier
  // file it duplicates is duplicate_of_file_id. A duplicate is ignored by the
  // item-status roll-up (deriveItemStatus) and hidden from the client portal.
  content_hash: string | null;
  is_duplicate: boolean;
  duplicate_of_file_id: string | null;
};

export async function listUploadedFilesForEngagement(
  engagement_id: string,
): Promise<UploadedFile[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("engagement_id", engagement_id)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UploadedFile[];
}

export async function signedDownloadUrl(
  storage_path: string,
  ttlSec = 900,
): Promise<string> {
  // Service role: the bucket is private and accountant downloads happen
  // server-side via this signed URL. RLS-wise the accountant already proved
  // firm membership to reach this code path.
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from("client-uploads")
    .createSignedUrl(storage_path, ttlSec);
  if (error || !data) throw error ?? new Error("signed_url_failed");
  return data.signedUrl;
}

// Batched variant: ONE storage round-trip to sign many paths at once. The
// engagement detail page pre-signs every upload, and doing that as N separate
// calls was a real chunk of its load time. Returns a path -> URL map; fail-soft
// (a path that errors or is missing just isn't in the map — callers fall back).
export async function signedDownloadUrls(
  storage_paths: string[],
  ttlSec = 900,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (storage_paths.length === 0) return out;
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from("client-uploads")
    .createSignedUrls(storage_paths, ttlSec);
  if (error || !data) return out;
  for (const row of data) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
