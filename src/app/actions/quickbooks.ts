"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { buildTransactionSuggestion } from "@/lib/quickbooks/suggest";
import { upsertTransactionSuggestion } from "@/lib/db/quickbooks-suggestions";
import { parseTransaction } from "@/lib/ai/transaction-extract";

export type RegenerateDraftState = {
  ok: boolean;
  error?:
    | "bad_request"
    | "not_found"
    | "no_firm"
    | "no_transaction"
    | "no_lists";
};

const LOCALES = ["en", "fr"] as const;

// Re-map a file's stored transaction read against the firm's CURRENT cached
// QuickBooks lists and rewrite its draft. The accountant uses this after they add
// the missing vendor/account in QuickBooks and refresh the cache — no re-upload,
// no second AI call (the extraction is reused from ai_extracted_fields). Still
// read-only on QuickBooks.
//
// Authorization: the file is read through the AUTHENTICATED client, so RLS scopes
// it to the caller's firm — a user can only regenerate drafts for their own
// firm's files. The upsert then uses the caller's firm id.
export async function regenerateDraftAction(
  uploadedFileId: string,
): Promise<RegenerateDraftState> {
  if (!uploadedFileId || typeof uploadedFileId !== "string") {
    return { ok: false, error: "bad_request" };
  }

  const sb = await getServerSupabase();
  const { data: file } = await sb
    .from("uploaded_files")
    .select("id, engagement_id, ai_extracted_fields")
    .eq("id", uploadedFileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "not_found" };

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };

  // Reuse the stored transaction read (re-validated defensively). No transaction
  // means this file isn't a mapped receipt/invoice — nothing to regenerate.
  const extracted = (file.ai_extracted_fields ?? {}) as Record<string, unknown>;
  const rawTxn = extracted.transaction;
  const transaction =
    rawTxn && typeof rawTxn === "object"
      ? parseTransaction(rawTxn as Record<string, unknown>)
      : null;
  if (!transaction) return { ok: false, error: "no_transaction" };

  const cached = await readCachedQuickbooksLists();
  if (!cached) return { ok: false, error: "no_lists" };

  const suggestion = buildTransactionSuggestion(transaction, cached);
  await upsertTransactionSuggestion({
    firmId: firm.id,
    uploadedFileId: file.id,
    engagementId: file.engagement_id as string,
    suggestion,
  });

  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${file.engagement_id}`);
  }
  return { ok: true };
}
