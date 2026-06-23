// QuickBooks transaction suggestions — Stage 3, Phase 3 data layer.
//
// READS go through the AUTHENTICATED client so RLS scopes them to the firm (the
// data is non-secret; migration 0430 grants firm members SELECT). WRITES (the
// classify worker generating the draft) go through the SERVICE role. Everything
// degrades gracefully (isMissingSchema) before 0430 is applied to the remote DB,
// so the engagement page never 500s if the migration hasn't landed yet.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";

// One stored draft: the AI suggestion + the accountant's resolved picks (Stage 4,
// null until they edit) + its status.
export type StoredDraft = {
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  status: string;
};

// Read every draft suggestion for an engagement, keyed by uploaded_file_id, so
// the page can drop the right card under each receipt/invoice. Authenticated +
// RLS firm-scoped. Returns an EMPTY map (never throws) when the table doesn't
// exist yet or on any read error — the cards just don't show. `resolved` is null
// before migration 0440 is applied (select degrades to the pre-0440 columns).
export async function getSuggestionsForEngagement(
  engagementId: string,
): Promise<Map<string, StoredDraft>> {
  const out = new Map<string, StoredDraft>();
  const sb = await getServerSupabase();
  const primary = await sb
    .from("quickbooks_transaction_suggestions")
    .select("uploaded_file_id, suggestion, resolved, status")
    .eq("engagement_id", engagementId);
  let rows = primary.data as Array<Record<string, unknown>> | null;
  let error = primary.error;
  // Graceful fallback if 0440 (resolved) isn't applied yet — re-read without it.
  if (error && isMissingSchema(error)) {
    const fb = await sb
      .from("quickbooks_transaction_suggestions")
      .select("uploaded_file_id, suggestion, status")
      .eq("engagement_id", engagementId);
    rows = fb.data as Array<Record<string, unknown>> | null;
    error = fb.error;
  }
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] getSuggestionsForEngagement failed:", error);
    }
    return out;
  }
  for (const row of rows ?? []) {
    const r = row as {
      uploaded_file_id: string | null;
      suggestion: TransactionSuggestion | null;
      resolved?: ResolvedEntry | null;
      status?: string | null;
    };
    if (r.uploaded_file_id && r.suggestion) {
      out.set(r.uploaded_file_id, {
        suggestion: r.suggestion,
        resolved: r.resolved ?? null,
        status: r.status ?? "draft",
      });
    }
  }
  return out;
}

// Read just the AI suggestion + accountant's resolved picks for one file, used to
// authorize + merge a partial edit. Authenticated (RLS firm-scoped) — a row for
// another firm simply isn't returned.
export async function getDraftForFile(
  uploadedFileId: string,
): Promise<{ engagementId: string; resolved: ResolvedEntry | null } | null> {
  const sb = await getServerSupabase();
  const primary = await sb
    .from("quickbooks_transaction_suggestions")
    .select("engagement_id, resolved")
    .eq("uploaded_file_id", uploadedFileId)
    .maybeSingle();
  let row = primary.data as Record<string, unknown> | null;
  let error = primary.error;
  if (error && isMissingSchema(error)) {
    const fb = await sb
      .from("quickbooks_transaction_suggestions")
      .select("engagement_id")
      .eq("uploaded_file_id", uploadedFileId)
      .maybeSingle();
    row = fb.data as Record<string, unknown> | null;
    error = fb.error;
  }
  if (error || !row) return null;
  return {
    engagementId: row.engagement_id as string,
    resolved: (row.resolved as ResolvedEntry | null) ?? null,
  };
}

// Persist the accountant's resolved mapping for one file (service role — the
// table has no authenticated write grant). Stamps who/when. Best-effort +
// graceful pre-0440 (a missing column is logged and swallowed).
export async function saveResolvedForFile(input: {
  uploadedFileId: string;
  resolved: ResolvedEntry;
  reviewerId: string | null;
}): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_transaction_suggestions")
    .update({
      resolved: input.resolved,
      reviewed_by: input.reviewerId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] saveResolvedForFile failed:", error);
    }
    return false;
  }
  return true;
}

// Persist (insert or replace) the draft suggestion for one uploaded file.
// Service-role write — authenticated users cannot write this table (0430).
// One row per file (onConflict uploaded_file_id). Best-effort: a missing table
// (pre-0430) or write error is logged and swallowed so it never breaks the
// classify worker that calls it.
export async function upsertTransactionSuggestion(input: {
  firmId: string;
  uploadedFileId: string;
  engagementId: string;
  suggestion: TransactionSuggestion;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("quickbooks_transaction_suggestions").upsert(
    {
      firm_id: input.firmId,
      uploaded_file_id: input.uploadedFileId,
      engagement_id: input.engagementId,
      suggestion: input.suggestion,
      direction: input.suggestion.direction,
      amount: input.suggestion.amount,
      status: "draft",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "uploaded_file_id" },
  );
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] upsertTransactionSuggestion failed:", error);
  }
}

// Remove the draft suggestion for one uploaded file. Service-role. Called by the
// classify worker when a (re)classification no longer yields a transaction (the
// document is no longer a receipt/invoice, or the read failed), so a stale draft
// never outlives the read that produced it. Best-effort + graceful pre-migration.
export async function deleteTransactionSuggestionForFile(
  uploadedFileId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_transaction_suggestions")
    .delete()
    .eq("uploaded_file_id", uploadedFileId);
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] deleteTransactionSuggestionForFile failed:", error);
  }
}
