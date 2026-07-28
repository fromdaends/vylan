// Data layer for payout journal drafts (migration 1010).
//
// GATED like every post-launch table: readers treat a missing table as "the
// payout journal isn't set up yet" and the app behaves exactly as before the
// migration. Error-code checks only, never message text (the 0650 rule).
//
// Reads go through the RLS session client (firm-scoped by policy); writes are
// service-role (the table grants no write to authenticated), so every write
// path re-proves firm ownership by hand.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import type { PayoutFigures } from "@/lib/ai/payout-reconcile";
import type { PayoutMapping } from "@/lib/quickbooks/payout-journal";

export function isPayoutJournalSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

export type PayoutJournalStatus = "draft" | "approved" | "posted" | "void";

export type PayoutJournalDraft = {
  id: string;
  uploadedFileId: string;
  engagementId: string;
  provider: "quickbooks" | "xero";
  figures: PayoutFigures;
  mapping: PayoutMapping;
  status: PayoutJournalStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  postedRef: string | null;
  postedLink: string | null;
  postedAt: string | null;
  postError: string | null;
};

function rowToDraft(row: Record<string, unknown>): PayoutJournalDraft {
  return {
    id: row.id as string,
    uploadedFileId: row.uploaded_file_id as string,
    engagementId: row.engagement_id as string,
    provider: row.provider === "xero" ? "xero" : "quickbooks",
    figures: (row.figures ?? {}) as PayoutFigures,
    mapping: (row.mapping ?? {}) as PayoutMapping,
    status: (row.status as PayoutJournalStatus) ?? "draft",
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    postedRef: (row.posted_ref as string | null) ?? null,
    postedLink: (row.posted_link as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    postError: (row.post_error as string | null) ?? null,
  };
}

const SELECT =
  "id, uploaded_file_id, engagement_id, provider, figures, mapping, status, reviewed_by, reviewed_at, posted_ref, posted_link, posted_at, post_error";

/** Every payout journal draft on one engagement, keyed by uploaded file id. */
export async function getPayoutJournalsForEngagement(
  engagementId: string,
): Promise<Map<string, PayoutJournalDraft>> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payout_journal_drafts")
    .select(SELECT)
    .eq("engagement_id", engagementId);
  if (error) {
    if (!isPayoutJournalSchemaMissing(error)) {
      console.error("[payout-journal] read failed:", error.message);
    }
    return new Map();
  }
  const out = new Map<string, PayoutJournalDraft>();
  for (const row of data ?? []) {
    const d = rowToDraft(row as Record<string, unknown>);
    out.set(d.uploadedFileId, d);
  }
  return out;
}

/**
 * Create the draft for a payout upload if it doesn't exist yet, snapshotting
 * the figures. Never overwrites an existing row: an approved or posted entry
 * must not silently change under the accountant if the file is
 * re-classified. Returns null when the table isn't there yet.
 */
export async function ensurePayoutJournalDraft(input: {
  firmId: string;
  uploadedFileId: string;
  engagementId: string;
  provider: "quickbooks" | "xero";
  figures: PayoutFigures;
}): Promise<PayoutJournalDraft | null> {
  const sb = getServiceRoleSupabase();
  const { data: existing, error: readErr } = await sb
    .from("payout_journal_drafts")
    .select(SELECT)
    .eq("uploaded_file_id", input.uploadedFileId)
    .maybeSingle();
  if (readErr && isPayoutJournalSchemaMissing(readErr)) return null;
  if (existing) return rowToDraft(existing as Record<string, unknown>);

  const { data, error } = await sb
    .from("payout_journal_drafts")
    .insert({
      firm_id: input.firmId,
      uploaded_file_id: input.uploadedFileId,
      engagement_id: input.engagementId,
      provider: input.provider,
      figures: input.figures,
      mapping: {},
    })
    .select(SELECT)
    .single();
  if (error) {
    // 23505 = another request created it first; read it back.
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("payout_journal_drafts")
        .select(SELECT)
        .eq("uploaded_file_id", input.uploadedFileId)
        .maybeSingle();
      return raced ? rowToDraft(raced as Record<string, unknown>) : null;
    }
    if (!isPayoutJournalSchemaMissing(error)) {
      console.error("[payout-journal] create failed:", error.message);
    }
    return null;
  }
  return rowToDraft(data as Record<string, unknown>);
}

/**
 * Merge account picks into the draft's mapping. Firm-scoped by hand (the
 * service role bypasses RLS). A POSTED entry is frozen — its mapping is the
 * record of what was actually booked.
 */
export async function savePayoutJournalMapping(input: {
  firmId: string;
  uploadedFileId: string;
  mapping: PayoutMapping;
}): Promise<"ok" | "not_found" | "frozen" | "unavailable" | "error"> {
  const sb = getServiceRoleSupabase();
  const { data: row, error: readErr } = await sb
    .from("payout_journal_drafts")
    .select("id, firm_id, status, mapping")
    .eq("uploaded_file_id", input.uploadedFileId)
    .maybeSingle();
  if (readErr) {
    return isPayoutJournalSchemaMissing(readErr) ? "unavailable" : "error";
  }
  if (!row || row.firm_id !== input.firmId) return "not_found";
  if (row.status === "posted") return "frozen";

  const merged = {
    ...((row.mapping as Record<string, unknown> | null) ?? {}),
    ...input.mapping,
  };
  const { error } = await sb
    .from("payout_journal_drafts")
    .update({ mapping: merged, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    console.error("[payout-journal] mapping save failed:", error.message);
    return "error";
  }
  return "ok";
}

/** Move a draft between review states. Posting is a separate write path. */
export async function setPayoutJournalStatus(input: {
  firmId: string;
  uploadedFileId: string;
  status: Extract<PayoutJournalStatus, "draft" | "approved" | "void">;
  userId: string | null;
}): Promise<"ok" | "not_found" | "frozen" | "unavailable" | "error"> {
  const sb = getServiceRoleSupabase();
  const { data: row, error: readErr } = await sb
    .from("payout_journal_drafts")
    .select("id, firm_id, status")
    .eq("uploaded_file_id", input.uploadedFileId)
    .maybeSingle();
  if (readErr) {
    return isPayoutJournalSchemaMissing(readErr) ? "unavailable" : "error";
  }
  if (!row || row.firm_id !== input.firmId) return "not_found";
  // A posted entry exists in the ledger; un-approving it here would be a lie.
  if (row.status === "posted") return "frozen";

  const { error } = await sb
    .from("payout_journal_drafts")
    .update({
      status: input.status,
      reviewed_by: input.status === "approved" ? input.userId : null,
      reviewed_at:
        input.status === "approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error("[payout-journal] status change failed:", error.message);
    return "error";
  }
  return "ok";
}

/** Record a successful post. Idempotency is enforced by the caller reading
 * status first; this is the write that makes it permanent. */
export async function recordPayoutJournalPosted(input: {
  firmId: string;
  uploadedFileId: string;
  postedRef: string;
  postedLink: string | null;
  userId: string | null;
}): Promise<"ok" | "error"> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("payout_journal_drafts")
    .update({
      status: "posted",
      posted_ref: input.postedRef,
      posted_link: input.postedLink,
      posted_by: input.userId,
      posted_at: new Date().toISOString(),
      post_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("firm_id", input.firmId)
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    console.error("[payout-journal] posted write failed:", error.message);
    return "error";
  }
  return "ok";
}

/** Record a FAILED post attempt so the accountant sees why. Leaves the status
 * at 'approved' so a retry is possible. */
export async function recordPayoutJournalPostError(input: {
  firmId: string;
  uploadedFileId: string;
  error: string;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("payout_journal_drafts")
    .update({
      post_error: input.error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("firm_id", input.firmId)
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    console.error("[payout-journal] error write failed:", error.message);
  }
}

/** One draft with the scope fields the post path needs. */
export async function getPayoutJournalForFile(
  uploadedFileId: string,
): Promise<(PayoutJournalDraft & { firmId: string; clientId: string }) | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("payout_journal_drafts")
    .select(`${SELECT}, firm_id, engagements(client_id)`)
    .eq("uploaded_file_id", uploadedFileId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isPayoutJournalSchemaMissing(error)) {
      console.error("[payout-journal] file read failed:", error.message);
    }
    return null;
  }
  const row = data as Record<string, unknown>;
  const eng = row.engagements as { client_id?: unknown } | null;
  const clientId = typeof eng?.client_id === "string" ? eng.client_id : "";
  if (!clientId) return null;
  return {
    ...rowToDraft(row),
    firmId: row.firm_id as string,
    clientId,
  };
}
