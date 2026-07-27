"use server";

// Server actions for the cloud-storage filing feature (Phase 1: settings).
// Connecting providers and running the filing engine arrive in later phases.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getEngagement } from "@/lib/db/engagements";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import {
  getFirmFilingSettings,
  getFirmStorageConnection,
  isFilingSchemaMissing,
  saveFirmFilingSettings,
  updateStorageConnectionConfig,
} from "@/lib/db/filing";
import {
  isInvoiceAttachmentPath,
  runEngagementFiling,
  type RunFilingResult,
} from "@/lib/filing/runner";
import { acquireMicrosoftConnectorContext } from "@/lib/filing/microsoft/connection";
import {
  ensureMicrosoftRootFolder,
  listMicrosoftDestinations,
  listSiteLibraries,
  type MicrosoftDestinationList,
  type MicrosoftLibrary,
} from "@/lib/filing/connectors/microsoft";
import {
  validateFolderTemplate,
  validateNameTemplate,
} from "@/lib/filing/template";

export type SaveFilingSettingsState = {
  ok: boolean;
  // Machine keys the client maps to localized copy.
  error?:
    | "no_session"
    | "owner_only"
    | "folder_empty"
    | "folder_unknown_token"
    | "folder_too_deep"
    | "folder_missing_client_token"
    | "name_empty"
    | "name_unknown_token"
    | "unavailable"
    | "save_failed";
  // The offending {token}s for unknown-token errors.
  unknownTokens?: string[];
} | null;

export async function saveFilingSettingsAction(
  input: {
    folderTemplate: string;
    nameTemplate: string;
    language: "en" | "fr";
    autoFileOnComplete: boolean;
  },
): Promise<SaveFilingSettingsState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  // Owner-only: filing settings decide where CLIENT DOCUMENTS land in the
  // firm's storage — same bar as connecting QuickBooks or Stripe.
  if (user.role !== "owner") return { ok: false, error: "owner_only" };

  const folderTemplate = input.folderTemplate.trim();
  const nameTemplate = input.nameTemplate.trim();

  const folderCheck = validateFolderTemplate(folderTemplate);
  if (!folderCheck.ok) {
    const map = {
      empty: "folder_empty",
      unknown_token: "folder_unknown_token",
      too_deep: "folder_too_deep",
      missing_client_token: "folder_missing_client_token",
      no_output: "folder_empty",
    } as const;
    return {
      ok: false,
      error: map[folderCheck.error],
      unknownTokens: folderCheck.unknownTokens,
    };
  }
  const nameCheck = validateNameTemplate(nameTemplate);
  if (!nameCheck.ok) {
    const map = {
      empty: "name_empty",
      unknown_token: "name_unknown_token",
      too_deep: "name_empty",
      missing_client_token: "name_empty",
      no_output: "name_empty",
    } as const;
    return {
      ok: false,
      error: map[nameCheck.error],
      unknownTokens: nameCheck.unknownTokens,
    };
  }

  const saved = await saveFirmFilingSettings({
    folderTemplate,
    nameTemplate,
    language: input.language === "fr" ? "fr" : "en",
    autoFileOnComplete: input.autoFileOnComplete === true,
  });
  if (saved === "unavailable") return { ok: false, error: "unavailable" };
  if (saved === "error") return { ok: false, error: "save_failed" };
  return { ok: true };
}

// ── Microsoft destination picker (Phase 3) ──────────────────────────────────
//
// Unlike Google (one auto-created folder), Microsoft needs a real choice:
// the owner's OneDrive OR a SharePoint site + document library. These two
// actions power the picker dialog; choose completes the connection (drive id
// into provider_config, root_label set, "Vylan" root folder created).


export type MicrosoftDestinationsState =
  | { ok: true; destinations: MicrosoftDestinationList }
  | { ok: false; error: "no_session" | "owner_only" | "not_connected" | "load_failed" };

export async function listMicrosoftDestinationsAction(): Promise<MicrosoftDestinationsState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };
  const acquired = await acquireMicrosoftConnectorContext(firm.id);
  if (acquired.kind !== "ok") return { ok: false, error: "not_connected" };
  try {
    return { ok: true, destinations: await listMicrosoftDestinations(acquired.ctx) };
  } catch (e) {
    console.error("[filing] destinations list failed:", (e as Error).message);
    return { ok: false, error: "load_failed" };
  }
}

export type MicrosoftLibrariesState =
  | { ok: true; libraries: MicrosoftLibrary[] }
  | { ok: false; error: "no_session" | "owner_only" | "not_connected" | "load_failed" };

export async function listMicrosoftSiteLibrariesAction(
  siteId: string,
): Promise<MicrosoftLibrariesState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };
  if (typeof siteId !== "string" || !siteId) {
    return { ok: false, error: "load_failed" };
  }
  const acquired = await acquireMicrosoftConnectorContext(firm.id);
  if (acquired.kind !== "ok") return { ok: false, error: "not_connected" };
  try {
    return { ok: true, libraries: await listSiteLibraries(acquired.ctx, siteId) };
  } catch (e) {
    console.error("[filing] libraries list failed:", (e as Error).message);
    return { ok: false, error: "load_failed" };
  }
}

export type ChooseMicrosoftDestinationState =
  | { ok: true }
  | {
      ok: false;
      error: "no_session" | "owner_only" | "not_connected" | "choose_failed";
    };

export async function chooseMicrosoftDestinationAction(input: {
  driveId: string;
  // Human breadcrumb for the card, e.g. "OneDrive" or "Accounting · Documents".
  label: string;
}): Promise<ChooseMicrosoftDestinationState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };
  const driveId = typeof input.driveId === "string" ? input.driveId.trim() : "";
  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim().slice(0, 120)
      : "OneDrive";
  if (!driveId) return { ok: false, error: "choose_failed" };
  const acquired = await acquireMicrosoftConnectorContext(firm.id);
  if (acquired.kind !== "ok") return { ok: false, error: "not_connected" };

  try {
    // Create (or find) the Vylan root in the chosen drive FIRST — if this
    // fails, the connection stays in "choose where to file" and can retry.
    const root = await ensureMicrosoftRootFolder(acquired.ctx, driveId, "Vylan");
    const saved = await updateStorageConnectionConfig(firm.id, {
      config: {
        driveId,
        rootFolderId: root.folderId,
        rootLink: root.link,
      },
      rootLabel: `${label} · Vylan`,
    });
    if (saved !== "ok") return { ok: false, error: "choose_failed" };
    return { ok: true };
  } catch (e) {
    console.error("[filing] destination choose failed:", (e as Error).message);
    return { ok: false, error: "choose_failed" };
  }
}

// ── Filing in action (Phase 4): status + on-demand run ──────────────────────

export type FilingDialogStatus =
  | { ok: false; error: "no_session" | "not_found" }
  | {
      ok: true;
      available: boolean;
      connection: {
        provider: "google_drive" | "microsoft" | "dropbox";
        rootLabel: string | null;
        needsDestination: boolean;
        needsReconnect: boolean;
      } | null;
      fileFinalDocuments: boolean;
      counts: {
        approved: number;
        notApproved: number;
        rejected: number;
        duplicates: number;
        finals: number;
      };
      lastRun: {
        at: string;
        trigger: "manual" | "auto";
        filed: number;
        skipped: number;
        failed: number;
      } | null;
    };

// Any firm member can view + run filing (the destination was chosen by the
// owner; running it is routine engagement work, like Download all).
export async function getFilingStatusAction(
  engagementId: string,
): Promise<FilingDialogStatus> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  const engagement = await getEngagement(engagementId).catch(() => null);
  if (!engagement) return { ok: false, error: "not_found" };

  const sb = await getServerSupabase();
  const [settings, connection, uploadsRes, finalsRes, runRes] =
    await Promise.all([
      getFirmFilingSettings(),
      getFirmStorageConnection(),
      sb
        .from("uploaded_files")
        .select("id, storage_path, review_status, is_duplicate")
        .eq("engagement_id", engagementId),
      sb
        .from("final_documents")
        .select("id, storage_path")
        .eq("engagement_id", engagementId),
      sb
        .from("filing_runs")
        .select("created_at, trigger_source, status, filed_count, skipped_count, failed_count")
        .eq("engagement_id", engagementId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const counts = {
    approved: 0,
    notApproved: 0,
    rejected: 0,
    duplicates: 0,
    finals: 0,
  };
  for (const f of uploadsRes.data ?? []) {
    if (f.is_duplicate) counts.duplicates += 1;
    else if (f.review_status === "approved" && f.storage_path) counts.approved += 1;
    else if (f.review_status === "rejected") counts.rejected += 1;
    else counts.notApproved += 1;
  }
  for (const d of finalsRes.data ?? []) {
    if (d.storage_path && !isInvoiceAttachmentPath(d.storage_path as string)) {
      counts.finals += 1;
    }
  }

  const run = runRes.data;
  return {
    ok: true,
    available: settings.available,
    connection:
      connection &&
      (connection.provider === "google_drive" ||
        connection.provider === "microsoft" ||
        connection.provider === "dropbox")
        ? {
            provider: connection.provider,
            rootLabel: connection.rootLabel,
            needsDestination:
              connection.provider === "microsoft" &&
              connection.status === "active" &&
              !connection.rootLabel,
            needsReconnect: connection.status === "error",
          }
        : null,
    fileFinalDocuments:
      (engagement as { file_final_documents?: boolean }).file_final_documents === true,
    counts,
    lastRun: run
      ? {
          at: run.created_at as string,
          trigger: run.trigger_source === "auto" ? "auto" : "manual",
          filed: (run.filed_count as number) ?? 0,
          skipped: (run.skipped_count as number) ?? 0,
          failed: (run.failed_count as number) ?? 0,
        }
      : null,
  };
}

export type RunFilingActionResult =
  | Extract<RunFilingResult, { ok: true }>
  | {
      ok: false;
      error:
        | "no_session"
        | Extract<RunFilingResult, { ok: false }>["error"];
    };

export async function runFilingAction(
  engagementId: string,
  opts?: { fileFinalDocuments?: boolean },
): Promise<RunFilingActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  // RLS re-proof: the engagement must be visible to this member's firm.
  const engagement = await getEngagement(engagementId).catch(() => null);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  // Persist the finals opt-in when the dialog changed it (per-engagement,
  // sticky — the next auto-run honors it too).
  if (typeof opts?.fileFinalDocuments === "boolean") {
    const sb = getServiceRoleSupabase();
    const { error } = await sb
      .from("engagements")
      .update({ file_final_documents: opts.fileFinalDocuments })
      .eq("id", engagementId)
      .eq("firm_id", firm.id);
    if (error && !isFilingSchemaMissing(error)) {
      console.error("[filing] finals opt-in save failed:", error.message);
    }
  }

  return runEngagementFiling({
    firmId: firm.id,
    engagementId,
    trigger: "manual",
    startedBy: user.id,
  });
}
