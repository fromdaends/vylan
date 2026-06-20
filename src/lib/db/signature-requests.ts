// Data layer for signature requests (SignWell e-signatures, Phase 2).
//
// Accountant-side reads/writes go through the RLS-scoped session client (firm
// members see only their own firm's rows). The client portal and the SignWell
// webhook use the service role (added in later phases). Everything degrades
// gracefully before migration 0400 is applied to the remote DB: a missing
// table/column is treated as "no signature requests yet" so the UI never
// hard-errors — same pattern as payment-requests.ts.

import { getServerSupabase } from "@/lib/supabase/server";
import type { SignatureStatus } from "@/lib/signwell/client";

export type SignatureRequest = {
  id: string;
  firm_id: string;
  engagement_id: string;
  request_item_id: string;
  signwell_document_id: string | null;
  status: SignatureStatus;
  test_mode: boolean;
  signer_email: string | null;
  signer_name: string | null;
  signed_file_path: string | null;
  completed_at: string | null;
  last_event_type: string | null;
  last_event_time: string | null;
  error_detail: string | null;
  created_at: string;
};

// PostgREST: PGRST205 = table not in schema cache (migration not applied),
// PGRST204 = column missing; 42P01 / 42703 are the Postgres equivalents.
function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "PGRST204" ||
    err.code === "42P01" ||
    err.code === "42703" ||
    /signature_requests/i.test(err.message ?? "")
  );
}

export type CreateSignatureRequestInput = {
  firm_id: string;
  engagement_id: string;
  request_item_id: string;
  signwell_document_id: string | null;
  status: SignatureStatus;
  test_mode: boolean;
  signer_email: string | null;
  signer_name: string | null;
  error_detail: string | null;
};

export async function createSignatureRequest(
  input: CreateSignatureRequestInput,
): Promise<SignatureRequest | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .insert(input)
    .select("*")
    .single();
  if (error) {
    if (isMissingSchema(error)) {
      console.warn(
        "[signature-requests] create: table missing (migration 0400 not applied yet)",
      );
      return null;
    }
    console.error("[signature-requests] create failed:", error);
    return null;
  }
  return data as SignatureRequest;
}

// All signature requests for an engagement (RLS-scoped). Used by the engagement
// detail page to show each signature item's status. Degrades to [] before
// migration 0400 is applied.
export async function listSignatureRequestsForEngagement(
  engagementId: string,
): Promise<SignatureRequest[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[signature-requests] list failed:", error);
    }
    return [];
  }
  return (data as SignatureRequest[]) ?? [];
}

// Map of request_item_id -> latest signature request, for the engagement's
// signature rows. request_item_id is unique, so there is at most one per item;
// rows are newest-first so the first seen per item wins regardless.
export async function getSignatureRequestsByItem(
  engagementId: string,
): Promise<Map<string, SignatureRequest>> {
  const rows = await listSignatureRequestsForEngagement(engagementId);
  const out = new Map<string, SignatureRequest>();
  for (const row of rows) {
    if (!out.has(row.request_item_id)) out.set(row.request_item_id, row);
  }
  return out;
}
