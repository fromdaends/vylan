// Rebuild the drafts that were skipped while a client's lists hadn't synced.
//
// The classify worker refuses to build a draft against an unsynced reference
// cache (see listsAreSynced): matching against empty lists produces a draft
// with every field unmatched, which reads to the accountant as "the AI failed"
// rather than "your client's lists haven't arrived yet".
//
// That guard is correct but leaves a hole. Disconnecting a client PURGES its
// cache and the re-sync is a background job, so anything uploaded in that
// window ends up with an extraction and no draft at all — and nothing ever went
// back for it. The accountant had to notice and press Refresh, which means
// knowing there was something to refresh.
//
// So the sync job now closes its own loop: the moment a client's lists land,
// any document already read but left without a draft gets one.
//
// Deliberately narrow — this is repair, not a re-sync of everything:
//   * only files with a transaction extraction (nothing else drafts),
//   * only files with NO existing suggestion row (never overwrites a draft the
//     accountant may already have edited or approved),
//   * newest first and capped, so a client with years of history can't turn one
//     sync into a thousand AI-free rebuilds.
//
// No AI is called: the extraction is already stored. This is pure re-matching.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { readCachedQuickbooksListsForFirm } from "@/lib/db/quickbooks-cache";
import { readCachedXeroListsForFirm } from "@/lib/db/xero-cache";
import { readLearnedMappingsForFirm } from "@/lib/db/quickbooks-learned";
import { buildTransactionSuggestion } from "@/lib/quickbooks/suggest";
import { listsAreSynced } from "@/lib/quickbooks/read";
import { upsertTransactionSuggestion } from "@/lib/db/quickbooks-suggestions";
import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

// How many documents one sync will repair. Comfortably above a realistic
// disconnect/reconnect window (a handful of uploads), far below "rebuild the
// client's entire history".
const MAX_BACKFILL = 50;

export type BackfillResult = { rebuilt: number; detail: string };

export async function rebuildMissingDraftsForClient(
  firmId: string,
  clientId: string,
  provider: "quickbooks" | "xero",
): Promise<BackfillResult> {
  const sb = getServiceRoleSupabase();
  try {
    const cached =
      provider === "xero"
        ? await readCachedXeroListsForFirm(firmId, clientId)
        : await readCachedQuickbooksListsForFirm(firmId, clientId);
    // The sync reported success but the cache is still empty — nothing to match
    // against, so there is nothing useful to rebuild.
    if (!listsAreSynced(cached)) return { rebuilt: 0, detail: "not_synced" };

    // This client's engagements, then their documents. Two point reads rather
    // than a join (the repo avoids PostgREST joins).
    const { data: engRows, error: engErr } = await sb
      .from("engagements")
      .select("id")
      .eq("client_id", clientId);
    if (engErr || !engRows?.length) return { rebuilt: 0, detail: "no_engagements" };
    const engagementIds = engRows.map((e) => (e as { id: string }).id);

    const { data: fileRows, error: fileErr } = await sb
      .from("uploaded_files")
      .select("id, engagement_id, ai_extracted_fields")
      .in("engagement_id", engagementIds)
      .order("uploaded_at", { ascending: false })
      .limit(MAX_BACKFILL * 4); // room to filter down to the ones needing work
    if (fileErr || !fileRows?.length) return { rebuilt: 0, detail: "no_files" };

    const withTransaction = fileRows.flatMap((r) => {
      const row = r as {
        id: string;
        engagement_id: string;
        ai_extracted_fields: { transaction?: TransactionExtraction } | null;
      };
      const t = row.ai_extracted_fields?.transaction;
      return t ? [{ id: row.id, engagementId: row.engagement_id, t }] : [];
    });
    if (withTransaction.length === 0) return { rebuilt: 0, detail: "none_extracted" };

    // Which of those ALREADY have a draft. Only the remainder are repaired —
    // never overwrite a draft the accountant may have edited or approved.
    const { data: existing } = await sb
      .from("quickbooks_transaction_suggestions")
      .select("uploaded_file_id")
      .in(
        "uploaded_file_id",
        withTransaction.map((f) => f.id),
      );
    const haveDraft = new Set(
      (existing ?? []).map(
        (r) => (r as { uploaded_file_id: string }).uploaded_file_id,
      ),
    );
    const todo = withTransaction
      .filter((f) => !haveDraft.has(f.id))
      .slice(0, MAX_BACKFILL);
    if (todo.length === 0) return { rebuilt: 0, detail: "nothing_missing" };

    const learned = await readLearnedMappingsForFirm(firmId, clientId);
    let rebuilt = 0;
    for (const f of todo) {
      const suggestion = buildTransactionSuggestion(
        f.t,
        cached,
        learned,
        provider === "xero" ? "Xero" : "QuickBooks",
      );
      // upsertTransactionSuggestion is itself best-effort (it swallows a
      // missing table); a row that fails to write just stays missing and the
      // next sync retries it.
      await upsertTransactionSuggestion({
        firmId,
        uploadedFileId: f.id,
        engagementId: f.engagementId,
        suggestion,
        provider,
      });
      rebuilt++;
    }
    return { rebuilt, detail: `rebuilt_${rebuilt}` };
  } catch (e) {
    // Best-effort: repair must never fail the sync that triggered it.
    console.warn("[backfill] rebuildMissingDraftsForClient failed:", e);
    return { rebuilt: 0, detail: "error" };
  }
}
