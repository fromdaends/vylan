// Data layer for signature requests (SignWell e-signatures, Phase 2).
//
// Accountant-side reads/writes go through the RLS-scoped session client (firm
// members see only their own firm's rows). The client portal and the SignWell
// webhook use the service role (added in later phases). Everything degrades
// gracefully before migration 0400 is applied to the remote DB: a missing
// table/column is treated as "no signature requests yet" so the UI never
// hard-errors — same pattern as payment-requests.ts.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
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

// RLS-scoped read of a single signature request by its item (accountant side).
// Firm isolation is enforced by RLS. Used when finalizing / resuming an embedded
// field-placement draft. Null if missing (or pre-0400).
export async function getSignatureRequestByItem(
  requestItemId: string,
): Promise<SignatureRequest | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .select("*")
    .eq("request_item_id", requestItemId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[signature-requests] getByItem failed:", error);
    }
    return null;
  }
  return (data as SignatureRequest) ?? null;
}

// RLS-scoped status update (accountant side): used to release an embedded
// field-placement draft (pending -> sent) once the accountant has placed the
// fields. Never overwrites a completed row. Returns true on a successful write.
export async function updateSignatureRequestStatus(
  id: string,
  status: SignatureStatus,
  opts: { errorDetail?: string | null } = {},
): Promise<boolean> {
  const sb = await getServerSupabase();
  const patch: Record<string, unknown> = { status };
  if ("errorDetail" in opts) patch.error_detail = opts.errorDetail ?? null;
  const { error } = await sb
    .from("signature_requests")
    .update(patch)
    .eq("id", id)
    .neq("status", "completed");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[signature-requests] updateStatus failed:", error);
    }
    return false;
  }
  return true;
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

// ── Service-role helpers ────────────────────────────────────────────────────
// Used by the unauthenticated client portal (embed route) and the SignWell
// webhook (Phase 4), neither of which has a user session. The service role
// bypasses RLS, so callers MUST derive the item/engagement from trusted server
// state (the magic token / the verified webhook), never from raw client input.

export async function getSignatureRequestByItemSR(
  requestItemId: string,
): Promise<SignatureRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .select("*")
    .eq("request_item_id", requestItemId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[signature-requests] getByItem(SR) failed:", error);
    }
    return null;
  }
  return (data as SignatureRequest) ?? null;
}

// Look a request up by its SignWell document id — the webhook's only handle.
export async function getSignatureRequestByDocumentIdSR(
  documentId: string,
): Promise<SignatureRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .select("*")
    .eq("signwell_document_id", documentId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[signature-requests] getByDocId(SR) failed:", error);
    }
    return null;
  }
  return (data as SignatureRequest) ?? null;
}

// Mark a request signed/completed. Idempotent: returns null (no-op) if the row
// is missing or already completed, so a re-delivered webhook + the reconcile
// backstop can't double-process. Returns the row's firm/engagement/item so the
// caller can log the activity.
export async function markSignatureCompletedSR(
  id: string,
  opts: {
    signedFilePath: string;
    eventType?: string | null;
    eventTime?: string | null;
  },
): Promise<{
  firmId: string;
  engagementId: string;
  requestItemId: string;
} | null> {
  const sb = getServiceRoleSupabase();
  const { data: cur } = await sb
    .from("signature_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!cur) return null;
  const row = cur as SignatureRequest;
  if (row.status === "completed") return null; // already processed
  const { error } = await sb
    .from("signature_requests")
    .update({
      status: "completed",
      signed_file_path: opts.signedFilePath,
      completed_at: new Date().toISOString(),
      last_event_type: opts.eventType ?? row.last_event_type,
      last_event_time: opts.eventTime ?? row.last_event_time,
    })
    .eq("id", id);
  if (error) {
    console.error("[signature-requests] markCompleted(SR) failed:", error);
    return null;
  }
  return {
    firmId: row.firm_id,
    engagementId: row.engagement_id,
    requestItemId: row.request_item_id,
  };
}

// Update a non-terminal status (viewed / declined / canceled / expired) from a
// webhook or reconcile. Never overwrites a completed row.
export async function updateSignatureStatusSR(
  id: string,
  status: SignatureStatus,
  opts: { eventType?: string | null; eventTime?: string | null } = {},
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { data: cur } = await sb
    .from("signature_requests")
    .select("status, engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (!cur) return;
  if ((cur as { status: SignatureStatus }).status === "completed") return;
  await sb
    .from("signature_requests")
    .update({
      status,
      last_event_type: opts.eventType ?? null,
      last_event_time: opts.eventTime ?? null,
    })
    .eq("id", id);

  // Signature events that AREN'T a completion still move the workflow: a
  // declined / canceled / expired request is no longer out with the client, so
  // the engagement must not sit at "Awaiting signature" waiting for a signature
  // that will never come. (A completion doesn't come through here — it goes
  // through finalizeSignatureCompletion, whose setItemStatus call re-resolves
  // the stage after the row is marked completed.)
  const engagementId = (cur as { engagement_id?: string }).engagement_id;
  if (engagementId) await syncEngagementStage(sb, engagementId);
}
