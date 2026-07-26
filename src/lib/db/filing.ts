// Data layer for the cloud-storage filing engine (migration 0900).
//
// GATED like every post-launch table: dev + previews point at the prod DB, so
// every reader treats a missing table/column as "filing not set up yet" and
// the app behaves exactly as before the migration. Error-code checks only,
// never message text (the 0650 rule).
//
// Reads run through the RLS session client (firm-scoped by policy). The
// engine's run/ledger writes are service-role and live here too so Phase 4's
// runner has one place to call; they re-prove firm ownership by hand because
// the service role bypasses RLS (same discipline as lib/archive/download.ts).

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import type { FilingLanguage } from "@/lib/filing/tokens";
import type {
  FilingSource,
  SkipReason,
  StorageProvider,
} from "@/lib/filing/types";

// PGRST205 = table missing from the schema cache, 42P01 = undefined table,
// PGRST204 / 42703 = missing column (partial applies).
export function isFilingSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

// ── Filing settings ─────────────────────────────────────────────────────────

export const FILING_DEFAULTS = {
  folderTemplate: "Clients/{client_name}/{year}/{category}",
  nameTemplate: "{doc_type} - {year} - {detail}",
  language: "en" as FilingLanguage,
  autoFileOnComplete: true,
};

export type FirmFilingSettings = {
  folderTemplate: string;
  nameTemplate: string;
  language: FilingLanguage;
  autoFileOnComplete: boolean;
  // False = no row yet (the firm has never saved) — defaults in effect.
  saved: boolean;
  // False = migration 0900 not applied — the whole feature is dormant.
  available: boolean;
};

function defaultSettings(available: boolean, saved = false): FirmFilingSettings {
  return {
    folderTemplate: FILING_DEFAULTS.folderTemplate,
    nameTemplate: FILING_DEFAULTS.nameTemplate,
    language: FILING_DEFAULTS.language,
    autoFileOnComplete: FILING_DEFAULTS.autoFileOnComplete,
    saved,
    available,
  };
}

/** The current firm's filing settings (RLS-scoped), with defaults applied. */
export async function getFirmFilingSettings(): Promise<FirmFilingSettings> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_filing_settings")
    .select("folder_template, name_template, language, auto_file_on_complete")
    .maybeSingle();
  if (error) {
    if (!isFilingSchemaMissing(error)) {
      console.error("[filing] settings read failed:", error.message);
    }
    return defaultSettings(false);
  }
  if (!data) return defaultSettings(true);
  return {
    folderTemplate: (data.folder_template as string) ?? FILING_DEFAULTS.folderTemplate,
    nameTemplate: (data.name_template as string) ?? FILING_DEFAULTS.nameTemplate,
    language: data.language === "fr" ? "fr" : "en",
    autoFileOnComplete: (data.auto_file_on_complete as boolean) ?? true,
    saved: true,
    available: true,
  };
}

/**
 * Upsert the current firm's filing settings. Template VALIDATION is the
 * caller's job (the server action) — this only persists. RLS scopes the row;
 * the action gates on owner.
 */
export async function saveFirmFilingSettings(input: {
  folderTemplate: string;
  nameTemplate: string;
  language: FilingLanguage;
  autoFileOnComplete: boolean;
}): Promise<"ok" | "unavailable" | "error"> {
  const firm = await getCurrentFirm();
  if (!firm) return "error";
  const sb = await getServerSupabase();
  const { error } = await sb.from("firm_filing_settings").upsert(
    {
      firm_id: firm.id,
      folder_template: input.folderTemplate,
      name_template: input.nameTemplate,
      language: input.language,
      auto_file_on_complete: input.autoFileOnComplete,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "firm_id" },
  );
  if (error) {
    if (isFilingSchemaMissing(error)) return "unavailable";
    console.error("[filing] settings save failed:", error.message);
    return "error";
  }
  return "ok";
}

// ── Storage connection (display shape) ──────────────────────────────────────

export type StorageConnectionDisplay = {
  id: string;
  provider: StorageProvider;
  status: "active" | "error" | "disconnected";
  accountLabel: string | null;
  rootLabel: string | null;
  connectedAt: string;
};

/** The current firm's ACTIVE connection, or null. Secrets are not readable
 * here by construction (column grants) — display fields only. */
export async function getFirmStorageConnection(): Promise<StorageConnectionDisplay | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .select("id, provider, status, account_label, root_label, connected_at")
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    if (!isFilingSchemaMissing(error)) {
      console.error("[filing] connection read failed:", error.message);
    }
    return null;
  }
  if (!data) return null;
  return {
    id: data.id as string,
    provider: data.provider as StorageProvider,
    status: data.status as StorageConnectionDisplay["status"],
    accountLabel: (data.account_label as string | null) ?? null,
    rootLabel: (data.root_label as string | null) ?? null,
    connectedAt: data.connected_at as string,
  };
}

// ── Runs + ledger (service-role writers for the engine) ─────────────────────

// The engine's FilingLedger, bound to one run. connection/firm/engagement/
// client ids are fixed at creation — after the caller has re-proven that the
// engagement belongs to the client and both belong to the connection's firm.
export type DbLedgerScope = {
  firmId: string;
  connectionId: string;
  runId: string;
  engagementId: string;
  clientId: string;
};

export async function createFilingRun(scope: {
  firmId: string;
  connectionId: string;
  engagementId: string;
  trigger: "manual" | "auto";
  startedBy: string | null;
}): Promise<string | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("filing_runs")
    .insert({
      firm_id: scope.firmId,
      connection_id: scope.connectionId,
      engagement_id: scope.engagementId,
      trigger_source: scope.trigger,
      started_by: scope.startedBy,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[filing] run create failed:", error.message);
    return null;
  }
  return data.id as string;
}

export async function finalizeFilingRun(
  runId: string,
  counts: { filed: number; skipped: number; failed: number },
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("filing_runs")
    .update({
      status: "complete",
      filed_count: counts.filed,
      skipped_count: counts.skipped,
      failed_count: counts.failed,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) console.error("[filing] run finalize failed:", error.message);
}

// Postgres unique-violation — the partial unique index (connection, source,
// file) WHERE filed caught a concurrent double-file. Exactly the race the
// index exists for; mapped to "duplicate", never treated as failure.
const UNIQUE_VIOLATION = "23505";

export function makeDbLedger(scope: DbLedgerScope) {
  const sb = getServiceRoleSupabase();
  const base = {
    firm_id: scope.firmId,
    connection_id: scope.connectionId,
    run_id: scope.runId,
    engagement_id: scope.engagementId,
    client_id: scope.clientId,
  };
  return {
    async alreadyFiled(source: FilingSource, fileId: string): Promise<boolean> {
      const { data, error } = await sb
        .from("filed_documents")
        .select("id")
        .eq("connection_id", scope.connectionId)
        .eq("source", source)
        .eq("file_id", fileId)
        .eq("status", "filed")
        .limit(1)
        .maybeSingle();
      if (error) {
        // Fail CLOSED for idempotency: if we can't verify, claim it's filed —
        // a wrongly-skipped file is recoverable (re-run later); a duplicate
        // upload into the firm's storage is not.
        console.error("[filing] alreadyFiled check failed:", error.message);
        return true;
      }
      return !!data;
    },
    async beginUpload(row: {
      source: FilingSource;
      fileId: string;
      folderPath: string;
      filedName: string;
    }): Promise<{ attemptId: string }> {
      // Intent BEFORE bytes: a crash mid-upload leaves this row as the trace
      // of where the document was headed. Throwing here (row not written)
      // stops THIS document before any upload — exactly right.
      const { data, error } = await sb
        .from("filed_documents")
        .insert({
          ...base,
          source: row.source,
          file_id: row.fileId,
          status: "uploading",
          folder_path: row.folderPath,
          filed_name: row.filedName,
        })
        .select("id")
        .single();
      if (error) throw new Error(`ledger intent write failed: ${error.message}`);
      return { attemptId: data.id as string };
    },
    async confirmFiled(
      attemptId: string,
      row: { filedName: string; providerFileId: string; link: string | null },
    ): Promise<"ok" | "duplicate"> {
      const { error } = await sb
        .from("filed_documents")
        .update({
          status: "filed",
          filed_name: row.filedName,
          provider_file_id: row.providerFileId,
          provider_link: row.link,
        })
        .eq("id", attemptId);
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          // Another run filed this document between our intent and confirm.
          // Settle OUR attempt row as the skip record (never leave 'uploading'
          // dangling), then let the engine report already_filed.
          await sb
            .from("filed_documents")
            .update({ status: "skipped", skip_reason: "already_filed" })
            .eq("id", attemptId);
          return "duplicate";
        }
        // The upload DID land but the ledger settle failed — rethrow so the
        // engine records a visible failure for this document rather than
        // silently believing it's tracked.
        throw new Error(`ledger confirm failed: ${error.message}`);
      }
      return "ok";
    },
    async markFailed(attemptId: string, errMsg: string): Promise<void> {
      const { error } = await sb
        .from("filed_documents")
        .update({ status: "failed", error_detail: errMsg.slice(0, 500) })
        .eq("id", attemptId);
      if (error) console.error("[filing] markFailed failed:", error.message);
    },
    async recordSkip(row: {
      source: FilingSource;
      fileId: string;
      reason: SkipReason;
    }): Promise<void> {
      const { error } = await sb.from("filed_documents").insert({
        ...base,
        source: row.source,
        file_id: row.fileId,
        status: "skipped",
        skip_reason: row.reason,
      });
      if (error) console.error("[filing] skip record failed:", error.message);
    },
    async recordFailure(row: {
      source: FilingSource;
      fileId: string;
      error: string;
    }): Promise<void> {
      const { error } = await sb.from("filed_documents").insert({
        ...base,
        source: row.source,
        file_id: row.fileId,
        status: "failed",
        error_detail: row.error.slice(0, 500),
      });
      if (error) console.error("[filing] failure record failed:", error.message);
    },
  };
}
