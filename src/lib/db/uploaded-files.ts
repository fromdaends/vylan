import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";

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
  uploaded_at: string;
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
