// The engagement letter for a SERVICE — one PDF per language (1580, re-keyed
// to the service catalogue in 1700).
//
// Founder's model: "accountants have a specific engagement letter that they
// send per service." So the letter lives on firm_services, beside the price
// and the task template that service implies.
//
// READS DEGRADE, WRITES REFUSE, the client-members.ts shape: before the
// migrations a read returns "no letter configured" (true for that
// environment, and the workflow action then records an honest skip) and a
// write names the file to run.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type LetterLocale = "en" | "fr";

export type EngagementLetter = {
  id: string;
  firmId: string;
  serviceId: string;
  locale: LetterLocale;
  storagePath: string;
  fileName: string;
  uploadedAt: string;
};

type Row = {
  id: string;
  firm_id: string;
  service_id: string | null;
  locale: string;
  storage_path: string;
  file_name: string;
  uploaded_at: string;
};

const COLS =
  "id, firm_id, service_id, locale, storage_path, file_name, uploaded_at";

// A row with no service is an orphan from the firm-wide 1580 shape; it can
// never be the letter for anything, so it is dropped on the way in rather
// than handed to a caller that would have to re-check.
function toLetters(rows: Row[]): EngagementLetter[] {
  const out: EngagementLetter[] = [];
  for (const r of rows) {
    if (!r.service_id) continue;
    out.push({
      id: r.id,
      firmId: r.firm_id,
      serviceId: r.service_id,
      locale: r.locale === "en" ? "en" : "fr",
      storagePath: r.storage_path,
      fileName: r.file_name,
      uploadedAt: r.uploaded_at,
    });
  }
  return out;
}

/** Both languages' letters for one service (RLS-scoped). */
export async function listServiceLetters(
  serviceId: string,
): Promise<EngagementLetter[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("engagement_letters")
    .select(COLS)
    .eq("service_id", serviceId);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return toLetters((data ?? []) as Row[]);
}

/** Which services have a letter at all — for the catalogue list's hint. */
export async function listFirmLetters(): Promise<EngagementLetter[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb.from("engagement_letters").select(COLS);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return toLetters((data ?? []) as Row[]);
}

/**
 * The letter to send for one service, service-role (the automated path runs
 * with no session). Prefers the client's own language and FALLS BACK to the
 * other one: a firm that uploaded only an English letter should still send it
 * to a French client rather than silently skipping — the accountant can see a
 * language mismatch, but they cannot see a letter that was never sent.
 */
export async function getLetterForServiceSR(
  serviceId: string,
  locale: LetterLocale,
): Promise<EngagementLetter | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_letters")
    .select(COLS)
    .eq("service_id", serviceId);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[engagement-letters] read failed:", error);
    }
    return null;
  }
  const letters = toLetters((data ?? []) as Row[]);
  return letters.find((l) => l.locale === locale) ?? letters[0] ?? null;
}

export async function upsertServiceLetter(input: {
  firmId: string;
  serviceId: string;
  locale: LetterLocale;
  storagePath: string;
  fileName: string;
  uploadedBy: string | null;
}): Promise<void> {
  const sb = await getServerSupabase();
  // The unique key is a PARTIAL index (service_id is nullable), which
  // onConflict cannot name — so replace explicitly: clear this service's
  // letter for this language, then insert. Two statements, but the only
  // window between them would replace a letter with the same letter.
  const { error: delErr } = await sb
    .from("engagement_letters")
    .delete()
    .eq("service_id", input.serviceId)
    .eq("locale", input.locale);
  if (delErr && !isMissingSchema(delErr)) throw delErr;

  const { error } = await sb.from("engagement_letters").insert({
    firm_id: input.firmId,
    service_id: input.serviceId,
    locale: input.locale,
    storage_path: input.storagePath,
    file_name: input.fileName,
    uploaded_by: input.uploadedBy,
    uploaded_at: new Date().toISOString(),
  });
  if (error) {
    if (isMissingSchema(error)) {
      throw new Error(
        "The engagement letter needs a database update (migrations 1580 + 1700).",
      );
    }
    throw error;
  }
}

export async function deleteServiceLetter(
  serviceId: string,
  locale: LetterLocale,
): Promise<void> {
  const sb = await getServerSupabase();
  const { error } = await sb
    .from("engagement_letters")
    .delete()
    .eq("service_id", serviceId)
    .eq("locale", locale);
  if (error && !isMissingSchema(error)) throw error;
}
