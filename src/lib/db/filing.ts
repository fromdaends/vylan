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

/** The current firm's connection (active OR error — error still renders the
 * card, with a reconnect prompt), or null. Secrets are not readable here by
 * construction (column grants) — display fields only. */
export async function getFirmStorageConnection(): Promise<StorageConnectionDisplay | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .select("id, provider, status, account_label, root_label, connected_at")
    .in("status", ["active", "error"])
    .order("connected_at", { ascending: false })
    .limit(1)
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

// ── Live-preview sample ─────────────────────────────────────────────────────

import { expectedYearFromTitle } from "@/lib/ai/matching";
import { resolveYear, type FilingTokenContext } from "@/lib/filing/tokens";

export type FilingPreviewSample = {
  tokenContext: FilingTokenContext;
  // Same document with the year unresolvable — the settings preview's second
  // line, showing the firm what the Unsorted fallback does.
  yearlessContext: FilingTokenContext;
  // True when built from one of the firm's real classified uploads.
  fromRealDocument: boolean;
};

function cannedSample(firmName: string): FilingPreviewSample {
  const base: FilingTokenContext = {
    clientName: "Marie Tremblay",
    clientType: "individual",
    firmName,
    engagementTitle: "T1 2024",
    docTypeCode: "t4",
    docConfidence: 0.95,
    year: 2024,
    issuerName: "Hydro-Québec",
    partyName: "Marie Tremblay",
    period: null,
    date: "2025-02-28",
    originalName: "IMG_4482.jpg",
  };
  return {
    tokenContext: base,
    yearlessContext: { ...base, year: null },
    fromRealDocument: false,
  };
}

/**
 * Build the settings page's live-preview sample from the firm's most recent
 * CLASSIFIED upload (RLS-scoped), falling back to a canned example for brand
 * new firms. Pure display data — nothing here is uploaded anywhere.
 */
export async function getFilingPreviewSample(
  firmName: string,
): Promise<FilingPreviewSample> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("uploaded_files")
    .select(
      "original_filename, ai_classification, ai_confidence, ai_extracted_fields, uploaded_at, engagements(*, clients(display_name, type))",
    )
    .not("ai_classification", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return cannedSample(firmName);

  const eng = data.engagements as unknown as
    | (Record<string, unknown> & {
        clients?: { display_name?: string | null; type?: string | null } | null;
      })
    | null;
  const client = eng?.clients ?? null;
  if (!eng || !client?.display_name) return cannedSample(firmName);

  const fields = (data.ai_extracted_fields ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;

  const title = str(eng.title) ?? "";
  const year = resolveYear({
    extractedYear: num(fields.extracted_year),
    // tax_year is a 0900 column — absent pre-migration, undefined reads null.
    engagementTaxYear: num(eng.tax_year),
    titleYear: expectedYearFromTitle(title),
    dueDate: str(eng.due_date),
  });

  const tokenContext: FilingTokenContext = {
    clientName: client.display_name,
    clientType: client.type === "business" ? "business" : "individual",
    firmName,
    engagementTitle: title,
    docTypeCode: str(data.ai_classification),
    docConfidence: num(data.ai_confidence),
    year,
    issuerName: str(fields.issuer_name),
    partyName: str(fields.party_name),
    period: str(fields.account_or_period),
    date:
      str(fields.document_date) ??
      String(data.uploaded_at ?? "").slice(0, 10),
    originalName: data.original_filename as string,
  };
  return {
    tokenContext,
    yearlessContext: { ...tokenContext, year: null },
    fromRealDocument: true,
  };
}

// ── Storage connection write path (service-role) ────────────────────────────

import {
  decryptStorageToken,
  maybeEncryptStorageToken,
  storageTokenFingerprint,
} from "@/lib/filing/token-cipher";

/**
 * Persist a Google Drive connection after OAuth. Revives the firm's most
 * recent google_drive row (any status) instead of inserting a new one, so the
 * connection id — and with it the filed_documents idempotency history — stays
 * continuous across disconnect/error/reconnect cycles. Refuses when another
 * provider is actively connected (v1: one destination per firm; the partial
 * unique index is the DB-level backstop).
 */
export async function saveGoogleConnection(input: {
  firmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  accountEmail: string | null;
  rootFolderId: string;
  rootLink: string | null;
  connectedBy: string;
}): Promise<"ok" | "other_provider" | "error"> {
  const sb = getServiceRoleSupabase();

  const { data: active, error: activeErr } = await sb
    .from("storage_connections")
    .select("id, provider")
    .eq("firm_id", input.firmId)
    .eq("status", "active")
    .maybeSingle();
  if (activeErr) {
    console.error("[filing] connection lookup failed:", activeErr.message);
    return "error";
  }
  if (active && active.provider !== "google_drive") return "other_provider";

  const row = {
    status: "active",
    access_token: maybeEncryptStorageToken(input.accessToken),
    refresh_token: maybeEncryptStorageToken(input.refreshToken),
    access_token_expires_at: input.accessTokenExpiresAt,
    refresh_token_fingerprint: storageTokenFingerprint(input.refreshToken),
    account_label: input.accountEmail,
    root_label: "Vylan",
    provider_config: {
      rootFolderId: input.rootFolderId,
      rootLink: input.rootLink,
    },
    connected_by: input.connectedBy,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    updated_at: new Date().toISOString(),
  };

  // Revive the newest google_drive row whatever its status (active row found
  // above is necessarily it), else insert fresh.
  const { data: existing } = await sb
    .from("storage_connections")
    .select("id")
    .eq("firm_id", input.firmId)
    .eq("provider", "google_drive")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("storage_connections")
      .update(row)
      .eq("id", existing.id);
    if (error) {
      console.error("[filing] connection update failed:", error.message);
      return "error";
    }
    return "ok";
  }
  const { error } = await sb
    .from("storage_connections")
    .insert({ firm_id: input.firmId, provider: "google_drive", ...row });
  if (error) {
    // 23505 = the one-active-per-firm partial unique index caught a racing
    // connect of another provider.
    console.error("[filing] connection insert failed:", error.message);
    return error.code === "23505" ? "other_provider" : "error";
  }
  return "ok";
}

export type ActiveConnectionTokens = {
  id: string;
  provider: StorageProvider;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  config: Record<string, unknown>;
};

/**
 * The firm's ACTIVE connection with decrypted tokens (service-role — callers
 * re-prove firm scope). "absent" = no usable connection (none active, or
 * tokens undecryptable => reconnect needed); "read_error" = transient.
 */
export async function readActiveConnectionTokens(
  firmId: string,
): Promise<
  | { kind: "ok"; conn: ActiveConnectionTokens }
  | { kind: "absent" }
  | { kind: "read_error" }
> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .select(
      "id, provider, access_token, refresh_token, access_token_expires_at, provider_config",
    )
    .eq("firm_id", firmId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    if (isFilingSchemaMissing(error)) return { kind: "absent" };
    console.error("[filing] token read failed:", error.message);
    return { kind: "read_error" };
  }
  if (!data || !data.access_token || !data.refresh_token) {
    return { kind: "absent" };
  }
  const accessToken = decryptStorageToken(data.access_token as string);
  const refreshToken = decryptStorageToken(data.refresh_token as string);
  if (accessToken == null || refreshToken == null) return { kind: "absent" };
  return {
    kind: "ok",
    conn: {
      id: data.id as string,
      provider: data.provider as StorageProvider,
      accessToken,
      refreshToken,
      accessTokenExpiresAt:
        (data.access_token_expires_at as string | null) ?? null,
      config:
        (data.provider_config as Record<string, unknown> | null) ?? {},
    },
  };
}

/**
 * Persist refreshed tokens with optimistic concurrency: the row must still
 * carry the fingerprint of the refresh token we refreshed FROM, so a
 * concurrent refresh never gets clobbered. "stale" = someone else won.
 */
export async function updateStorageConnectionTokens(
  firmId: string,
  matchRefreshToken: string,
  next: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
  },
): Promise<"ok" | "stale" | "error"> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .update({
      access_token: maybeEncryptStorageToken(next.accessToken),
      refresh_token: maybeEncryptStorageToken(next.refreshToken),
      access_token_expires_at: next.accessTokenExpiresAt,
      refresh_token_fingerprint: storageTokenFingerprint(next.refreshToken),
      updated_at: new Date().toISOString(),
    })
    .eq("firm_id", firmId)
    .eq("status", "active")
    .eq("refresh_token_fingerprint", storageTokenFingerprint(matchRefreshToken))
    .select("id");
  if (error) {
    console.error("[filing] token update failed:", error.message);
    return "error";
  }
  return (data?.length ?? 0) > 0 ? "ok" : "stale";
}

/** Flag the active connection as needing a reconnect (dead refresh token). */
export async function markStorageConnectionError(firmId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("storage_connections")
    .update({ status: "error", updated_at: new Date().toISOString() })
    .eq("firm_id", firmId)
    .eq("status", "active");
  if (error) console.error("[filing] mark error failed:", error.message);
}

/**
 * Disconnect the firm's connection (owner action). Tokens are cleared from
 * the row (the caller revokes them with Google first); the row itself is KEPT
 * for ledger continuity. Returns the decrypted refresh token for revocation,
 * or null when there was nothing to disconnect.
 */
export async function disconnectFirmStorageConnection(
  firmId: string,
): Promise<{ refreshToken: string | null } | null> {
  const read = await readActiveConnectionTokens(firmId);
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      refresh_token_fingerprint: null,
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("status", ["active", "error"])
    .eq("firm_id", firmId)
    .select("id");
  if (error) {
    if (isFilingSchemaMissing(error)) return null;
    console.error("[filing] disconnect failed:", error.message);
    return null;
  }
  if ((data?.length ?? 0) === 0) return null;
  return {
    refreshToken: read.kind === "ok" ? read.conn.refreshToken : null,
  };
}

/**
 * Display detail for the connected card: the root-folder link out to the
 * provider. provider_config is deliberately not SELECT-granted to browsers,
 * so this reads it with the service role AFTER the RLS-scoped display read
 * has already proven the row belongs to the current firm.
 */
export async function getStorageConnectionRootLink(
  connectionId: string,
): Promise<string | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("storage_connections")
    .select("provider_config")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) return null;
  const link = (data.provider_config as Record<string, unknown> | null)
    ?.rootLink;
  return typeof link === "string" ? link : null;
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
