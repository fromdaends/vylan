"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { readCachedXeroLists } from "@/lib/db/xero-cache";
import {
  getClientXeroStatus,
  readClientXeroBaseCurrency,
} from "@/lib/db/xero";
import { readFirmLearnedMappings } from "@/lib/db/quickbooks-learned";
import { buildTransactionSuggestion } from "@/lib/quickbooks/suggest";
import { upsertTransactionSuggestion } from "@/lib/db/quickbooks-suggestions";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import type { LearnedMappings } from "@/lib/quickbooks/suggest";
import { parseTransaction } from "@/lib/ai/transaction-extract";
import { revalidateAllLocales } from "@/lib/revalidate";

export type RegenerateDraftState = {
  ok: boolean;
  error?:
    | "bad_request"
    | "not_found"
    | "no_firm"
    | "no_transaction"
    | "no_lists";
};


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

  // 0790: which product this file's client is connected to. A client connects
  // EITHER QuickBooks OR Xero — resolve the engagement's client, and if it's
  // Xero-connected, remap against the Xero cache (per-client) instead. The
  // QuickBooks path is unchanged. Both reads (auth/RLS) degrade to null.
  const engagementId = file.engagement_id as string;
  const { data: eng } = await sb
    .from("engagements")
    .select("client_id")
    .eq("id", engagementId)
    .maybeSingle();
  const clientId = (eng?.client_id as string | null) ?? null;
  const isXero =
    clientId != null && (await getClientXeroStatus(clientId)) != null;

  let cached: QuickbooksLists | null;
  let learned: LearnedMappings;
  if (isXero && clientId) {
    cached = await readCachedXeroLists(clientId);
    learned = await readFirmLearnedMappings(clientId);
  } else {
    cached = await readCachedQuickbooksLists();
    // Feature 3: apply this CLIENT's remembered corrections (RLS read; {}
    // pre-0490). Scoped to the client to match where the resolve route writes
    // them and what the classify worker reads — this branch used to read the
    // firm-level (client_id IS NULL) namespace, which was the only reader that
    // lined up with the old unscoped write, so clicking Refresh was the one
    // place learning appeared to work. `clientId ?? undefined` keeps the
    // firm-level read for a legacy engagement with no client.
    learned = await readFirmLearnedMappings(clientId ?? undefined);
  }
  if (!cached) return { ok: false, error: "no_lists" };

  const provider = isXero ? "xero" : "quickbooks";
  // Xero records the organisation's currency on connect and its posts state one
  // explicitly, so pass it: that is what lets a US firm's USD receipt through
  // instead of parking it at "needs input" forever. QuickBooks sends no currency
  // on the post at all, so it passes nothing and keeps its CAD assumption.
  const booksCurrency =
    isXero && clientId
      ? await readClientXeroBaseCurrency(firm.id, clientId)
      : null;
  const suggestion = buildTransactionSuggestion(
    transaction,
    cached,
    learned,
    isXero ? "Xero" : "QuickBooks",
    booksCurrency,
    // Only Xero's RECEIVE bank transaction needs a deposit account.
    isXero,
  );
  await upsertTransactionSuggestion({
    firmId: firm.id,
    uploadedFileId: file.id,
    engagementId,
    suggestion,
    provider,
  });

  revalidateAllLocales(`/engagements/${file.engagement_id}`);

  return { ok: true };
}
