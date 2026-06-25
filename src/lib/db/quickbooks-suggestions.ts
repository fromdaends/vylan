// QuickBooks transaction suggestions — Stage 3, Phase 3 data layer.
//
// READS go through the AUTHENTICATED client so RLS scopes them to the firm (the
// data is non-secret; migration 0430 grants firm members SELECT). WRITES (the
// classify worker generating the draft) go through the SERVICE role. Everything
// degrades gracefully (isMissingSchema) before 0430 is applied to the remote DB,
// so the engagement page never 500s if the migration hasn't landed yet.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  buildTransactionSuggestion,
  type TransactionSuggestion,
  type ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import {
  normalizeDraftStatus,
  type DraftStatus,
} from "@/lib/quickbooks/draft-status";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

// The Stage 5 post columns a row may carry (all null/0 before migration 0450).
export type PostState = {
  postedQboId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  postError: string | null;
};

// One stored draft: the AI suggestion + the accountant's resolved picks (Stage 4,
// null until they edit) + its status + who last reviewed it (approved / dismissed
// / reopened / edited) and when + (Stage 5) its post state.
export type StoredDraft = {
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  status: DraftStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
} & PostState;

// The select column sets, widest first. Each reader tries them in order and
// falls through on a missing-schema error, so the app degrades gracefully across
// the migration windows (0450 = posted_* columns; 0440 = resolved + reviewed_*).
const ENGAGEMENT_SELECTS = [
  "uploaded_file_id, suggestion, resolved, status, reviewed_by, reviewed_at, posted_qbo_id, posted_at, posted_by, post_error",
  "uploaded_file_id, suggestion, resolved, status, reviewed_by, reviewed_at",
  "uploaded_file_id, suggestion, status",
] as const;

// Read every draft suggestion for an engagement, keyed by uploaded_file_id, so
// the page can drop the right card under each receipt/invoice. Authenticated +
// RLS firm-scoped. Returns an EMPTY map (never throws) when the table doesn't
// exist yet or on any read error — the cards just don't show.
export async function getSuggestionsForEngagement(
  engagementId: string,
): Promise<Map<string, StoredDraft>> {
  const out = new Map<string, StoredDraft>();
  const sb = await getServerSupabase();
  let rows: Array<Record<string, unknown>> | null = null;
  let error: { code?: string; message?: string } | null = null;
  for (const sel of ENGAGEMENT_SELECTS) {
    const res = await sb
      .from("quickbooks_transaction_suggestions")
      .select(sel)
      .eq("engagement_id", engagementId);
    if (res.error && isMissingSchema(res.error)) {
      error = res.error;
      continue; // try the narrower column set
    }
    rows = res.data as Array<Record<string, unknown>> | null;
    error = res.error;
    break;
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
      reviewed_by?: string | null;
      reviewed_at?: string | null;
      posted_qbo_id?: string | null;
      posted_at?: string | null;
      posted_by?: string | null;
      post_error?: string | null;
    };
    if (r.uploaded_file_id && r.suggestion) {
      out.set(r.uploaded_file_id, {
        suggestion: r.suggestion,
        resolved: r.resolved ?? null,
        status: normalizeDraftStatus(r.status),
        reviewedBy: r.reviewed_by ?? null,
        reviewedAt: r.reviewed_at ?? null,
        postedQboId: r.posted_qbo_id ?? null,
        postedAt: r.posted_at ?? null,
        postedBy: r.posted_by ?? null,
        postError: r.post_error ?? null,
      });
    }
  }
  return out;
}

// One row of the firm-wide drafts QUEUE (Stage 4, Phase 3): a draft plus the
// context the queue needs to show it (which client, engagement, document).
export type FirmDraftRow = {
  fileId: string;
  engagementId: string;
  engagementTitle: string | null;
  clientId: string | null;
  clientName: string | null;
  documentName: string | null;
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  status: DraftStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
} & PostState;

const FIRM_SELECTS = [
  "uploaded_file_id, engagement_id, suggestion, resolved, status, reviewed_by, reviewed_at, created_at, updated_at, posted_qbo_id, posted_at, posted_by, post_error",
  "uploaded_file_id, engagement_id, suggestion, resolved, status, reviewed_by, reviewed_at, created_at, updated_at",
  "uploaded_file_id, engagement_id, suggestion, status, created_at, updated_at",
] as const;

// Read EVERY draft for the firm (newest first) with its client/engagement/file
// context, for the firm-wide queue page. Authenticated + RLS firm-scoped (the
// SELECT policy on each table is the firm boundary — no explicit firm_id filter
// needed). Follows the repo's batch-load-then-map pattern (no PostgREST joins):
// load the suggestions, then load the referenced engagements, files, and clients
// in parallel and stitch them together in memory. Returns [] (never throws) when
// the table doesn't exist yet (pre-migration) or on any read error.
export async function listFirmDrafts(): Promise<FirmDraftRow[]> {
  const sb = await getServerSupabase();
  let rows: Array<Record<string, unknown>> | null = null;
  let error: { code?: string; message?: string } | null = null;
  for (const sel of FIRM_SELECTS) {
    const res = await sb
      .from("quickbooks_transaction_suggestions")
      .select(sel)
      .order("created_at", { ascending: false });
    if (res.error && isMissingSchema(res.error)) {
      error = res.error;
      continue;
    }
    rows = res.data as Array<Record<string, unknown>> | null;
    error = res.error;
    break;
  }
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] listFirmDrafts failed:", error);
    }
    return [];
  }
  // engagement_id is NOT NULL in the schema, but guard it anyway: a row without
  // one can't render a valid /engagements/[id] link, so drop it rather than emit
  // a broken row.
  const valid = (rows ?? []).filter(
    (r) => r.uploaded_file_id && r.suggestion && r.engagement_id,
  ) as Array<Record<string, unknown>>;
  if (valid.length === 0) return [];

  const engagementIds = [
    ...new Set(valid.map((r) => r.engagement_id as string).filter(Boolean)),
  ];
  const fileIds = [
    ...new Set(valid.map((r) => r.uploaded_file_id as string).filter(Boolean)),
  ];

  // Batch-load engagements + files in parallel (both RLS firm-scoped).
  const [engRes, fileRes] = await Promise.all([
    engagementIds.length
      ? sb
          .from("engagements")
          .select("id, title, client_id")
          .in("id", engagementIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    fileIds.length
      ? sb
          .from("uploaded_files")
          .select("id, display_name, original_filename")
          .in("id", fileIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);
  const engById = new Map(
    ((engRes.data as Array<Record<string, unknown>> | null) ?? []).map((e) => [
      e.id as string,
      {
        title: (e.title as string | null) ?? null,
        clientId: (e.client_id as string | null) ?? null,
      },
    ]),
  );
  const fileById = new Map(
    ((fileRes.data as Array<Record<string, unknown>> | null) ?? []).map((f) => [
      f.id as string,
      ((f.display_name as string | null) ??
        (f.original_filename as string | null)) ??
        null,
    ]),
  );

  // Then the clients referenced by those engagements.
  const clientIds = [
    ...new Set(
      [...engById.values()].map((e) => e.clientId).filter(Boolean) as string[],
    ),
  ];
  const clientRes = clientIds.length
    ? await sb.from("clients").select("id, display_name").in("id", clientIds)
    : { data: [] as Array<Record<string, unknown>> };
  const clientNameById = new Map(
    ((clientRes.data as Array<Record<string, unknown>> | null) ?? []).map(
      (c) => [c.id as string, (c.display_name as string | null) ?? null],
    ),
  );

  return valid.map((r) => {
    const engagementId = r.engagement_id as string;
    const eng = engById.get(engagementId);
    const clientId = eng?.clientId ?? null;
    return {
      fileId: r.uploaded_file_id as string,
      engagementId,
      engagementTitle: eng?.title ?? null,
      clientId,
      clientName: clientId ? (clientNameById.get(clientId) ?? null) : null,
      documentName: fileById.get(r.uploaded_file_id as string) ?? null,
      suggestion: r.suggestion as TransactionSuggestion,
      resolved: (r.resolved as ResolvedEntry | null) ?? null,
      status: normalizeDraftStatus(r.status as string | null),
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: (r.reviewed_at as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
      postedQboId: (r.posted_qbo_id as string | null) ?? null,
      postedAt: (r.posted_at as string | null) ?? null,
      postedBy: (r.posted_by as string | null) ?? null,
      postError: (r.post_error as string | null) ?? null,
    };
  });
}

// Read one draft for authorization + context: the engagement + firm it belongs
// to, the accountant's resolved picks, the AI suggestion, and the current status.
// Authenticated (RLS firm-scoped) — a row for another firm simply isn't returned,
// which IS the authorization. Used by the resolve (edit) route and the status
// (approve/dismiss/reopen) route.
export async function getDraftForFile(uploadedFileId: string): Promise<{
  engagementId: string;
  firmId: string;
  resolved: ResolvedEntry | null;
  suggestion: TransactionSuggestion | null;
  status: DraftStatus;
  // Stage 5 post state. postReady is true only when the 0450 columns exist — the
  // post/void routes refuse to touch QuickBooks when false, so a write can always
  // be recorded (no post-without-record / double-post window).
  postedQboId: string | null;
  postedSyncToken: string | null;
  postAttempt: number;
  postReady: boolean;
} | null> {
  const sb = await getServerSupabase();
  const selects = [
    "engagement_id, firm_id, resolved, suggestion, status, posted_qbo_id, posted_qbo_sync_token, post_attempt",
    "engagement_id, firm_id, resolved, suggestion, status",
    "engagement_id, firm_id, suggestion, status",
  ] as const;
  let row: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;
  let tier = 0;
  for (let i = 0; i < selects.length; i++) {
    const res = await sb
      .from("quickbooks_transaction_suggestions")
      .select(selects[i])
      .eq("uploaded_file_id", uploadedFileId)
      .maybeSingle();
    if (res.error && isMissingSchema(res.error)) {
      error = res.error;
      continue;
    }
    row = res.data as Record<string, unknown> | null;
    error = res.error;
    tier = i;
    break;
  }
  if (error || !row) return null;
  return {
    engagementId: row.engagement_id as string,
    firmId: row.firm_id as string,
    resolved: (row.resolved as ResolvedEntry | null) ?? null,
    suggestion: (row.suggestion as TransactionSuggestion | null) ?? null,
    status: normalizeDraftStatus(row.status as string | null),
    postedQboId: (row.posted_qbo_id as string | null) ?? null,
    postedSyncToken: (row.posted_qbo_sync_token as string | null) ?? null,
    postAttempt: (row.post_attempt as number | null) ?? 0,
    // Only the widest select (tier 0) carries the 0450 columns.
    postReady: tier === 0,
  };
}

// Flip a draft's status (approve / dismiss / reopen) and stamp who acted + when.
// Service-role write — authenticated users have no write grant on this table
// (0430), exactly like saveResolvedPatch / upsertTransactionSuggestion. The
// caller authorizes first via getDraftForFile (RLS-scoped) and validates the
// transition; this is a plain single-column flip with no read-modify-write race.
// Best-effort: a missing table/column (pre-migration) or error returns false.
export async function setDraftStatus(input: {
  uploadedFileId: string;
  status: DraftStatus;
  reviewerId: string | null;
}): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("quickbooks_transaction_suggestions")
    .update({
      status: input.status,
      reviewed_by: input.reviewerId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] setDraftStatus failed:", error);
    }
    return false;
  }
  return true;
}

// "ok" = recorded; "conflict" = the row changed under us (a concurrent reopen or
// void) so we did NOT record — the caller must not claim success; "error" = a
// genuine DB failure.
export type RecordPostedResult = "ok" | "conflict" | "error";

// Stage 5 — record a SUCCESSFUL post: flip status to 'posted', store the QBO
// transaction id + SyncToken (needed to void later), stamp who/when, and clear
// any prior post_error. Service-role write, but CONDITIONAL: it only applies when
// the row is STILL status='approved' AND post_attempt is unchanged from what the
// post used to build its idempotency requestid. This closes two races on the
// write path: (a) a concurrent void bumps post_attempt, so our requestid would
// have deduped to the now-voided transaction — the attempt mismatch makes us
// refuse to record it; (b) a concurrent reopen flips status away from 'approved'
// — the status guard refuses the illegal -> 'posted' transition. In both cases
// we return "conflict" (a 0-row update) instead of recording bad state; the
// stable requestid means the genuine retry re-finds the same transaction.
export async function recordDraftPosted(input: {
  uploadedFileId: string;
  expectedAttempt: number;
  postedQboId: string;
  postedSyncToken: string;
  posterId: string | null;
}): Promise<RecordPostedResult> {
  const sb = getServiceRoleSupabase();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("quickbooks_transaction_suggestions")
    .update({
      status: "posted",
      posted_qbo_id: input.postedQboId,
      posted_qbo_sync_token: input.postedSyncToken,
      posted_at: now,
      posted_by: input.posterId,
      post_error: null,
      updated_at: now,
    })
    .eq("uploaded_file_id", input.uploadedFileId)
    .eq("status", "approved")
    .eq("post_attempt", input.expectedAttempt)
    .select("uploaded_file_id");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] recordDraftPosted failed:", error);
    }
    return "error";
  }
  return data && data.length > 0 ? "ok" : "conflict";
}

// Stage 5 — record a FAILED post: keep status 'approved' (so it can be retried)
// and store the error for the accountant to see. Service-role write.
export async function recordDraftPostError(input: {
  uploadedFileId: string;
  error: string;
}): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_transaction_suggestions")
    .update({
      post_error: input.error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] recordDraftPostError failed:", error);
    }
    return false;
  }
  return true;
}

// Stage 5 — record an UNDO (the QBO transaction was voided): return the draft to
// 'approved', clear the posted id/sync token, bump post_attempt (so a re-post
// uses a FRESH idempotency requestid rather than re-fetching the voided txn), and
// clear posted_at/by + any error. Service-role write.
export async function recordDraftVoided(input: {
  uploadedFileId: string;
  nextAttempt: number;
}): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_transaction_suggestions")
    .update({
      status: "approved",
      posted_qbo_id: null,
      posted_qbo_sync_token: null,
      post_attempt: input.nextAttempt,
      posted_at: null,
      posted_by: null,
      post_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("uploaded_file_id", input.uploadedFileId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] recordDraftVoided failed:", error);
    }
    return false;
  }
  return true;
}

// Atomically MERGE the changed field(s) of the accountant's resolved mapping for
// one file (service role — the table has no authenticated write grant). Uses the
// merge_qbo_resolved function (migration 0440) so two quick edits to different
// fields can't clobber each other via a read-modify-write race. `patch` carries
// only the field(s) that changed; a field set to null reverts to the AI match.
// Best-effort: a missing function (pre-0440) or error returns false.
export async function saveResolvedPatch(input: {
  uploadedFileId: string;
  patch: Partial<ResolvedEntry>;
  reviewerId: string | null;
}): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.rpc("merge_qbo_resolved", {
    p_file_id: input.uploadedFileId,
    p_patch: input.patch,
    p_reviewer: input.reviewerId,
  });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] saveResolvedPatch failed:", error);
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

// Self-heal: regenerate any MISSING draft from the file's already-stored
// transaction read (uploaded_files.ai_extracted_fields.transaction). The classify
// worker normally creates the draft, but a row can go missing (re-upload race, a
// classify that ran before the migration was applied, manual cleanup). Mirrors
// the payment/signature reconcile-on-load this page already does, so a draft can
// never silently vanish. No AI call — it reuses the stored transaction + the
// firm's cached lists. Returns how many it created. Best-effort throughout.
export async function backfillMissingSuggestions(input: {
  firmId: string;
  engagementId: string;
  files: { id: string; ai_extracted_fields: Record<string, unknown> | null }[];
  lists: QuickbooksLists | null;
  existingFileIds: Set<string>;
}): Promise<number> {
  if (!input.lists) return 0;
  let created = 0;
  for (const f of input.files) {
    if (input.existingFileIds.has(f.id)) continue;
    const rawTxn = f.ai_extracted_fields?.transaction;
    // Only files that actually carry a stored transaction read; the `taxes`
    // array is the shape guard (the worker always writes it). Our own data, so a
    // cast is safe after the guard.
    if (
      !rawTxn ||
      typeof rawTxn !== "object" ||
      !Array.isArray((rawTxn as { taxes?: unknown }).taxes)
    ) {
      continue;
    }
    try {
      const suggestion = buildTransactionSuggestion(
        rawTxn as TransactionExtraction,
        input.lists,
      );
      await upsertTransactionSuggestion({
        firmId: input.firmId,
        uploadedFileId: f.id,
        engagementId: input.engagementId,
        suggestion,
      });
      created++;
    } catch (err) {
      console.warn("[quickbooks] backfillMissingSuggestions failed for", f.id, err);
    }
  }
  return created;
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
