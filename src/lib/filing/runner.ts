// The filing RUNNER — everything between "file this engagement" and the
// engine. Loads candidates with the full ownership re-proof chain, builds the
// token contexts, dispatches to the right provider connector, and owns the
// filing_run row lifecycle. Runs server-side with the SERVICE ROLE (jobs have
// no session), so every read re-proves scope by hand:
//
//     engagement.firm_id === firmId === connection.firm
//     client.id === engagement.client_id && client.firm_id === firmId
//
// The engine then re-asserts one-run-one-client and the rendered-path client
// guard on top (belt and braces — this is the correctness-critical path).

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { downloadObject } from "@/lib/storage";
import {
  FILING_DEFAULTS,
  createFilingRun,
  finalizeFilingRun,
  makeDbLedger,
  readActiveConnectionTokens,
  isFilingSchemaMissing,
} from "@/lib/db/filing";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { runFiling, FilingGuardError } from "./engine";
import { googleDriveConnector } from "./connectors/google-drive";
import { microsoftConnector } from "./connectors/microsoft";
import { acquireGoogleConnectorContext } from "./google/connection";
import { acquireMicrosoftConnectorContext } from "./microsoft/connection";
import { acquireDropboxConnectorContext } from "./dropbox/connection";
import { dropboxConnector } from "./connectors/dropbox";
import { validateFolderTemplate, validateNameTemplate } from "./template";
import { resolveYear, type FilingLanguage, type FilingTokenContext } from "./tokens";
import type {
  ConnectorContext,
  FilingCandidate,
  FilingReport,
  StorageConnector,
} from "./types";

// ── Pure candidate building (unit-tested) ───────────────────────────────────

export type UploadedRow = {
  id: string;
  storage_path: string | null;
  original_filename: string;
  mime_type: string | null;
  review_status: "pending" | "approved" | "rejected";
  is_duplicate: boolean;
  ai_classification: string | null;
  ai_confidence: number | null;
  ai_extracted_fields: Record<string, unknown> | null;
  uploaded_at: string;
};

export type FinalRow = {
  id: string;
  storage_path: string | null;
  original_filename: string;
  mime_type: string | null;
  created_at: string;
};

export type EngagementContext = {
  engagementId: string;
  title: string;
  dueDate: string | null;
  taxYear: number | null;
  clientName: string;
  clientType: "individual" | "business";
  firmName: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** One upload row -> engine candidate + its token context. */
export function buildCandidate(
  row: UploadedRow,
  eng: EngagementContext,
): { doc: FilingCandidate; tokenContext: FilingTokenContext } {
  const fields = row.ai_extracted_fields ?? {};
  const extractedYear = num(fields.extracted_year);
  const year = resolveYear({
    extractedYear,
    engagementTaxYear: eng.taxYear,
    titleYear: expectedYearFromTitle(eng.title),
    dueDate: eng.dueDate,
  });
  return {
    doc: {
      source: "checklist",
      fileId: row.id,
      engagementId: eng.engagementId,
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      reviewStatus: row.review_status,
      isDuplicate: row.is_duplicate,
      docTypeCode: row.ai_classification,
      docConfidence: row.ai_confidence,
      extractedYear,
      issuerName: str(fields.issuer_name),
      partyName: str(fields.party_name),
      accountOrPeriod: str(fields.account_or_period),
      documentDate: str(fields.document_date),
      uploadedAt: row.uploaded_at,
    },
    tokenContext: {
      clientName: eng.clientName,
      clientType: eng.clientType,
      firmName: eng.firmName,
      engagementTitle: eng.title,
      docTypeCode: row.ai_classification,
      docConfidence: row.ai_confidence,
      year,
      issuerName: str(fields.issuer_name),
      partyName: str(fields.party_name),
      period: str(fields.account_or_period),
      date: str(fields.document_date) ?? row.uploaded_at.slice(0, 10),
      originalName: row.original_filename,
    },
  };
}

/**
 * One final-document row -> candidate + context. Finals carry no
 * classification: they file as generic documents under the engagement's year
 * (their names are usually already deliberate — {original_name} serves them
 * best, but that's the firm's template call).
 */
export function buildFinalCandidate(
  row: FinalRow,
  eng: EngagementContext,
): { doc: FilingCandidate; tokenContext: FilingTokenContext } {
  const year = resolveYear({
    extractedYear: null,
    engagementTaxYear: eng.taxYear,
    titleYear: expectedYearFromTitle(eng.title),
    dueDate: eng.dueDate,
  });
  return {
    doc: {
      source: "final",
      fileId: row.id,
      engagementId: eng.engagementId,
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      reviewStatus: null,
      isDuplicate: false,
      docTypeCode: null,
      docConfidence: null,
      extractedYear: null,
      issuerName: null,
      partyName: null,
      accountOrPeriod: null,
      documentDate: null,
      uploadedAt: row.created_at,
    },
    tokenContext: {
      clientName: eng.clientName,
      clientType: eng.clientType,
      firmName: eng.firmName,
      engagementTitle: eng.title,
      docTypeCode: null,
      docConfidence: null,
      year,
      issuerName: null,
      partyName: null,
      period: null,
      date: row.created_at.slice(0, 10),
      originalName: row.original_filename,
    },
  };
}

/** Invoice PDFs live in final_documents but are never client documents —
 * excluded before eligibility (same rule as the archive ZIP). */
export function isInvoiceAttachmentPath(path: string | null): boolean {
  return !!path && path.includes("/invoices/");
}

// ── The run ─────────────────────────────────────────────────────────────────

export type EnrichedOutcome = FilingReport["outcomes"][number] & {
  displayName: string;
};

export type RunFilingResult =
  | {
      ok: true;
      runId: string;
      filed: number;
      skipped: number;
      failed: number;
      outcomes: EnrichedOutcome[];
    }
  | {
      ok: false;
      error:
        | "unavailable" // migration/schema missing
        | "no_connection" // nothing connected
        | "needs_destination" // microsoft connected but no drive picked
        | "reconnect_required" // grant dead
        | "not_found" // engagement not in this firm
        | "run_failed"; // transient — safe to retry
    };

export async function runEngagementFiling(input: {
  firmId: string;
  engagementId: string;
  trigger: "manual" | "auto";
  startedBy: string | null;
}): Promise<RunFilingResult> {
  const sb = getServiceRoleSupabase();

  // 1. Connection + provider dispatch.
  const read = await readActiveConnectionTokens(input.firmId);
  if (read.kind === "read_error") return { ok: false, error: "run_failed" };
  if (read.kind === "absent") return { ok: false, error: "no_connection" };
  const provider = read.conn.provider;

  let connector: StorageConnector;
  let ctx: ConnectorContext;
  if (provider === "google_drive") {
    const acquired = await acquireGoogleConnectorContext(input.firmId);
    if (acquired.kind === "dead") return { ok: false, error: "reconnect_required" };
    if (acquired.kind !== "ok") return { ok: false, error: "run_failed" };
    connector = googleDriveConnector;
    ctx = acquired.ctx;
    if (typeof ctx.config.rootFolderId !== "string") {
      return { ok: false, error: "reconnect_required" };
    }
  } else if (provider === "microsoft") {
    const acquired = await acquireMicrosoftConnectorContext(input.firmId);
    if (acquired.kind === "dead") return { ok: false, error: "reconnect_required" };
    if (acquired.kind !== "ok") return { ok: false, error: "run_failed" };
    connector = microsoftConnector;
    ctx = acquired.ctx;
    // Connected but the destination picker was never completed.
    if (typeof ctx.config.driveId !== "string") {
      return { ok: false, error: "needs_destination" };
    }
  } else if (provider === "dropbox") {
    const acquired = await acquireDropboxConnectorContext(input.firmId);
    if (acquired.kind === "dead") return { ok: false, error: "reconnect_required" };
    if (acquired.kind !== "ok") return { ok: false, error: "run_failed" };
    connector = dropboxConnector;
    ctx = acquired.ctx;
    // App-folder access: the root is the app folder itself — nothing to check.
  } else {
    // A provider without a connector yet can't have connected — defensive.
    return { ok: false, error: "no_connection" };
  }

  // 2. Engagement + client + firm, with the ownership re-proof chain.
  const { data: eng, error: engErr } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, title, due_date, tax_year, file_final_documents, deleted_at")
    .eq("id", input.engagementId)
    .maybeSingle();
  if (engErr) {
    return {
      ok: false,
      error: isFilingSchemaMissing(engErr) ? "unavailable" : "run_failed",
    };
  }
  if (!eng || eng.firm_id !== input.firmId || eng.deleted_at) {
    return { ok: false, error: "not_found" };
  }
  const { data: client } = await sb
    .from("clients")
    .select("id, firm_id, display_name, type")
    .eq("id", eng.client_id as string)
    .maybeSingle();
  if (!client || client.firm_id !== input.firmId) {
    return { ok: false, error: "not_found" };
  }
  const { data: firm } = await sb
    .from("firms")
    .select("name")
    .eq("id", input.firmId)
    .maybeSingle();

  // 3. Firm filing settings (service-role — jobs have no session). Stored
  // templates were validated at save; a legacy-invalid one falls back to the
  // defaults rather than blocking filing.
  let folderTemplate = FILING_DEFAULTS.folderTemplate;
  let nameTemplate = FILING_DEFAULTS.nameTemplate;
  let language: FilingLanguage = FILING_DEFAULTS.language;
  {
    const { data: settings, error: settingsErr } = await sb
      .from("firm_filing_settings")
      .select("folder_template, name_template, language")
      .eq("firm_id", input.firmId)
      .maybeSingle();
    if (settingsErr && isFilingSchemaMissing(settingsErr)) {
      return { ok: false, error: "unavailable" };
    }
    if (settings) {
      const folder = str(settings.folder_template);
      const name = str(settings.name_template);
      if (folder && validateFolderTemplate(folder).ok) folderTemplate = folder;
      if (name && validateNameTemplate(name).ok) nameTemplate = name;
      language = settings.language === "fr" ? "fr" : "en";
    }
  }

  // 4. Candidates.
  const engCtx: EngagementContext = {
    engagementId: eng.id as string,
    title: (eng.title as string) ?? "",
    dueDate: (eng.due_date as string | null) ?? null,
    taxYear: num(eng.tax_year),
    clientName: (client.display_name as string) ?? "",
    clientType: client.type === "business" ? "business" : "individual",
    firmName: (firm?.name as string) ?? "",
  };
  const [uploadsRes, finalsRes] = await Promise.all([
    sb
      .from("uploaded_files")
      .select(
        "id, storage_path, original_filename, display_name, mime_type, review_status, is_duplicate, ai_classification, ai_confidence, ai_extracted_fields, uploaded_at",
      )
      .eq("engagement_id", input.engagementId)
      // Soft-deleted documents are never filed out to the firm's cloud storage
      // (spec). Service role, so RLS does not do this for us.
      .is("deleted_at", null),
    sb
      .from("final_documents")
      .select("id, storage_path, original_filename, display_name, mime_type, created_at")
      .is("deleted_at", null)
      .eq("engagement_id", input.engagementId),
  ]);

  const displayNames = new Map<string, string>();
  const candidates: Array<{
    doc: FilingCandidate;
    tokenContext: FilingTokenContext;
  }> = [];
  for (const row of (uploadsRes.data ?? []) as Array<
    UploadedRow & { display_name: string | null }
  >) {
    displayNames.set(row.id, row.display_name ?? row.original_filename);
    candidates.push(buildCandidate(row, engCtx));
  }
  for (const row of (finalsRes.data ?? []) as Array<
    FinalRow & { display_name: string | null }
  >) {
    if (isInvoiceAttachmentPath(row.storage_path)) continue;
    displayNames.set(row.id, row.display_name ?? row.original_filename);
    candidates.push(buildFinalCandidate(row, engCtx));
  }

  // 5. Run row + ledger + the engine.
  const runId = await createFilingRun({
    firmId: input.firmId,
    connectionId: read.conn.id,
    engagementId: input.engagementId,
    trigger: input.trigger,
    startedBy: input.startedBy,
  });
  if (!runId) return { ok: false, error: "run_failed" };

  const ledger = makeDbLedger({
    firmId: input.firmId,
    connectionId: read.conn.id,
    runId,
    engagementId: input.engagementId,
    clientId: client.id as string,
  });

  try {
    const report = await runFiling(
      {
        connector,
        ctx,
        ledger,
        downloadBytes: async (path) => new Uint8Array(await downloadObject(path)),
      },
      {
        engagementId: input.engagementId,
        clientName: engCtx.clientName,
        fileFinalDocuments: eng.file_final_documents === true,
        folderTemplate,
        nameTemplate,
        language,
        candidates,
      },
    );
    await finalizeFilingRun(runId, {
      filed: report.filedCount,
      skipped: report.skippedCount,
      failed: report.failedCount,
    });
    return {
      ok: true,
      runId,
      filed: report.filedCount,
      skipped: report.skippedCount,
      failed: report.failedCount,
      outcomes: report.outcomes.map((o) => ({
        ...o,
        displayName: displayNames.get(o.fileId) ?? "Document",
      })),
    };
  } catch (e) {
    // FilingGuardError = assembly invariant violated (a bug, not a doc
    // problem); anything else here is unexpected. Either way: finalize what
    // the ledger recorded and report a retryable failure.
    if (e instanceof FilingGuardError) {
      console.error("[filing] GUARD:", e.message);
    } else {
      console.error("[filing] run crashed:", (e as Error).message);
    }
    await finalizeFilingRun(runId, { filed: 0, skipped: 0, failed: 0 });
    return { ok: false, error: "run_failed" };
  }
}

// ── Auto-file entry point (the file_to_storage job handler) ─────────────────

export type AutoFilingResult =
  | { ok: true; ran: false; reason: string }
  | { ok: true; ran: true; filed: number; skipped: number; failed: number }
  | { ok: false; transient: boolean; reason: string };

/**
 * Called by the jobs worker when an engagement completes. Quietly no-ops when
 * the firm turned auto-file off or has nothing connected; runs the filing
 * otherwise. Only transient failures ask for a retry.
 */
export async function runAutoFiling(
  engagementId: string,
): Promise<AutoFilingResult> {
  if (!engagementId) return { ok: true, ran: false, reason: "no_engagement" };
  const sb = getServiceRoleSupabase();
  const { data: eng, error } = await sb
    .from("engagements")
    .select("id, firm_id, status, deleted_at")
    .eq("id", engagementId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      transient: !isFilingSchemaMissing(error),
      reason: error.message,
    };
  }
  // Reopened or deleted since the job was queued: nothing to do.
  if (!eng || eng.deleted_at || eng.status !== "complete") {
    return { ok: true, ran: false, reason: "not_complete" };
  }

  const { data: settings, error: settingsErr } = await sb
    .from("firm_filing_settings")
    .select("auto_file_on_complete")
    .eq("firm_id", eng.firm_id as string)
    .maybeSingle();
  if (settingsErr && isFilingSchemaMissing(settingsErr)) {
    return { ok: true, ran: false, reason: "unavailable" };
  }
  // No settings row = defaults = auto-file ON (matches getFirmFilingSettings).
  if (settings && settings.auto_file_on_complete === false) {
    return { ok: true, ran: false, reason: "auto_off" };
  }

  const result = await runEngagementFiling({
    firmId: eng.firm_id as string,
    engagementId,
    trigger: "auto",
    startedBy: null,
  });
  if (result.ok) {
    return {
      ok: true,
      ran: true,
      filed: result.filed,
      skipped: result.skipped,
      failed: result.failed,
    };
  }
  // Only a transient run failure retries; everything else (no connection,
  // needs destination, reconnect, unavailable) resolves quietly — the
  // on-demand dialog is where those states are surfaced to a human.
  if (result.error === "run_failed") {
    return { ok: false, transient: true, reason: result.error };
  }
  return { ok: true, ran: false, reason: result.error };
}
