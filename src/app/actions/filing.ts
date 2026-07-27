"use server";

// Server actions for the cloud-storage filing feature (Phase 1: settings).
// Connecting providers and running the filing engine arrive in later phases.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  saveFirmFilingSettings,
  updateStorageConnectionConfig,
} from "@/lib/db/filing";
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
