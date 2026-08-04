// The firm's engagement letter — one PDF per language (migration 1580).
//
// READS DEGRADE, WRITES REFUSE, the client-members.ts shape: before 1580 a
// read returns "no letter configured" (true for that environment, and the
// workflow action then records an honest skip) and a write names the file to
// run.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type LetterLocale = "en" | "fr";

export type EngagementLetter = {
  id: string;
  firmId: string;
  locale: LetterLocale;
  storagePath: string;
  fileName: string;
  uploadedAt: string;
};

type Row = {
  id: string;
  firm_id: string;
  locale: string;
  storage_path: string;
  file_name: string;
  uploaded_at: string;
};

function toLetter(r: Row): EngagementLetter {
  return {
    id: r.id,
    firmId: r.firm_id,
    locale: r.locale === "en" ? "en" : "fr",
    storagePath: r.storage_path,
    fileName: r.file_name,
    uploadedAt: r.uploaded_at,
  };
}

const COLS = "id, firm_id, locale, storage_path, file_name, uploaded_at";

/** Both languages' letters for the current firm (RLS-scoped). */
export async function listFirmLetters(): Promise<EngagementLetter[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb.from("engagement_letters").select(COLS);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return ((data ?? []) as Row[]).map(toLetter);
}

/**
 * The letter to send a client, service-role (the automated path runs with no
 * session). Prefers the client's own language and FALLS BACK to the other
 * one: a firm that uploaded only an English letter should still send it to a
 * French client rather than silently skipping — the accountant can see the
 * language mismatch, but they cannot see a letter that was never sent.
 */
export async function getLetterForClientSR(
  firmId: string,
  locale: LetterLocale,
): Promise<EngagementLetter | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_letters")
    .select(COLS)
    .eq("firm_id", firmId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[engagement-letters] read failed:", error);
    }
    return null;
  }
  const letters = ((data ?? []) as Row[]).map(toLetter);
  return (
    letters.find((l) => l.locale === locale) ?? letters[0] ?? null
  );
}

export async function upsertFirmLetter(input: {
  firmId: string;
  locale: LetterLocale;
  storagePath: string;
  fileName: string;
  uploadedBy: string | null;
}): Promise<void> {
  const sb = await getServerSupabase();
  const { error } = await sb.from("engagement_letters").upsert(
    {
      firm_id: input.firmId,
      locale: input.locale,
      storage_path: input.storagePath,
      file_name: input.fileName,
      uploaded_by: input.uploadedBy,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "firm_id,locale" },
  );
  if (error) {
    if (isMissingSchema(error)) {
      throw new Error(
        "The engagement letter needs a database update (migration 1580).",
      );
    }
    throw error;
  }
}

export async function deleteFirmLetter(
  firmId: string,
  locale: LetterLocale,
): Promise<void> {
  const sb = await getServerSupabase();
  const { error } = await sb
    .from("engagement_letters")
    .delete()
    .eq("firm_id", firmId)
    .eq("locale", locale);
  if (error && !isMissingSchema(error)) throw error;
}
