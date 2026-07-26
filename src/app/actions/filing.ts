"use server";

// Server actions for the cloud-storage filing feature (Phase 1: settings).
// Connecting providers and running the filing engine arrive in later phases.

import { getCurrentUser } from "@/lib/db/users";
import { saveFirmFilingSettings } from "@/lib/db/filing";
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
