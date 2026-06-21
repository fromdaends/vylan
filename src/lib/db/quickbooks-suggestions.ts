// QuickBooks transaction suggestions — Stage 3, Phase 3 data layer.
//
// READS go through the AUTHENTICATED client so RLS scopes them to the firm (the
// data is non-secret; migration 0430 grants firm members SELECT). WRITES (the
// classify worker generating the draft) go through the SERVICE role. Everything
// degrades gracefully (isMissingSchema) before 0430 is applied to the remote DB,
// so the engagement page never 500s if the migration hasn't landed yet.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";

// Read every draft suggestion for an engagement, keyed by uploaded_file_id, so
// the page can drop the right card under each receipt/invoice. Authenticated +
// RLS firm-scoped. Returns an EMPTY map (never throws) when the table doesn't
// exist yet or on any read error — the cards just don't show.
export async function getSuggestionsForEngagement(
  engagementId: string,
): Promise<Map<string, TransactionSuggestion>> {
  const out = new Map<string, TransactionSuggestion>();
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("quickbooks_transaction_suggestions")
    .select("uploaded_file_id, suggestion")
    .eq("engagement_id", engagementId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] getSuggestionsForEngagement failed:", error);
    }
    return out;
  }
  for (const row of data ?? []) {
    const fileId = row.uploaded_file_id as string | null;
    const suggestion = row.suggestion as TransactionSuggestion | null;
    if (fileId && suggestion) out.set(fileId, suggestion);
  }
  return out;
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
