// Download layer for the per-client document archive.
//
// The archive's browse read (src/lib/db/client-archive.ts) runs through the
// RLS-scoped session client. DOWNLOADS are different: like every other download
// in this app they read + sign object bytes with the SERVICE ROLE, which
// BYPASSES RLS — so every function here re-proves firm ownership by hand. The
// scoping anchor is always: the client belongs to the firm, AND the file's
// engagement belongs to that same client + firm (and isn't soft-deleted). A
// file that fails any check is an indistinguishable null (the routes turn that
// into a 404 — no cross-firm existence oracle).

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { AppLocale } from "@/lib/format";
import type { ArchiveCategoryKey } from "@/lib/db/client-archive";
import { asciiFilePart, macZipEntryName } from "@/lib/zip";

export type ResolvedArchiveFile = {
  storagePath: string;
  filename: string;
  mimeType: string | null;
};

// ASCII-safe category folder names for the ZIP layout. Kept here (not pulled
// from i18n) because ZIP folder text must be plain ASCII anyway and this keeps
// the layout builder pure/testable. asciiFilePart strips the accents.
const CATEGORY_FOLDER_LABEL: Record<ArchiveCategoryKey, Record<AppLocale, string>> = {
  checklist: { en: "Checklist documents", fr: "Documents de la liste" },
  signed: { en: "Signed documents", fr: "Documents signés" },
  final: { en: "Final documents", fr: "Documents finaux" },
};

function isInvoiceAttachment(path: string): boolean {
  return path.includes("/invoices/");
}

// The in-ZIP path for one archived file: "<Category>/<leaf>", with rejected
// checklist files set apart under "<Checklist>/Rejected/<leaf>". Pure + ASCII so
// it's stable across macOS/Windows/Linux unzip and safe to unit-test.
export function archiveEntryPath(
  category: ArchiveCategoryKey,
  rawName: string,
  rejected: boolean,
  locale: AppLocale,
): string {
  const folder = asciiFilePart(CATEGORY_FOLDER_LABEL[category][locale], 80) || "Documents";
  const leaf = macZipEntryName(rawName);
  if (category === "checklist" && rejected) {
    return `${folder}/Rejected/${leaf}`;
  }
  return `${folder}/${leaf}`;
}

type SB = ReturnType<typeof getServiceRoleSupabase>;

async function clientInFirm(sb: SB, clientId: string, firmId: string): Promise<boolean> {
  const { data } = await sb
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("firm_id", firmId)
    .maybeSingle();
  return !!data;
}

async function engagementInScope(
  sb: SB,
  engagementId: string,
  clientId: string,
  firmId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("engagements")
    .select("id")
    .eq("id", engagementId)
    .eq("client_id", clientId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

// Resolve ONE archive file to its storage location + download name, only if it
// belongs to this firm's client. Returns null for anything out of scope.
export async function resolveArchiveFile(input: {
  firmId: string;
  clientId: string;
  category: ArchiveCategoryKey;
  fileId: string;
  locale: AppLocale;
}): Promise<ResolvedArchiveFile | null> {
  const { firmId, clientId, category, fileId, locale } = input;
  const sb = getServiceRoleSupabase();

  if (!(await clientInFirm(sb, clientId, firmId))) return null;

  if (category === "checklist") {
    // uploaded_files has no firm_id — scope via its engagement.
    const { data: f } = await sb
      .from("uploaded_files")
      .select("storage_path, original_filename, display_name, mime_type, engagement_id, is_duplicate")
      .eq("id", fileId)
      .maybeSingle();
    if (!f || !f.storage_path || f.is_duplicate) return null;
    if (!(await engagementInScope(sb, f.engagement_id as string, clientId, firmId))) return null;
    return {
      storagePath: f.storage_path as string,
      filename: (f.display_name as string | null) ?? (f.original_filename as string),
      mimeType: (f.mime_type as string | null) ?? null,
    };
  }

  if (category === "final") {
    const { data: d } = await sb
      .from("final_documents")
      .select("storage_path, original_filename, display_name, mime_type, engagement_id")
      .eq("id", fileId)
      .eq("firm_id", firmId)
      .maybeSingle();
    if (!d || !d.storage_path) return null;
    // Invoices live in final_documents but are never part of the archive.
    if (isInvoiceAttachment(d.storage_path as string)) return null;
    if (!(await engagementInScope(sb, d.engagement_id as string, clientId, firmId))) return null;
    return {
      storagePath: d.storage_path as string,
      filename: (d.display_name as string | null) ?? (d.original_filename as string),
      mimeType: (d.mime_type as string | null) ?? null,
    };
  }

  // signed
  const { data: s } = await sb
    .from("signature_requests")
    .select("signed_file_path, engagement_id, request_item_id")
    .eq("id", fileId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!s || !s.signed_file_path) return null;
  if (!(await engagementInScope(sb, s.engagement_id as string, clientId, firmId))) return null;
  const { data: item } = await sb
    .from("request_items")
    .select("label, label_fr")
    .eq("id", s.request_item_id as string)
    .maybeSingle();
  const label = item
    ? locale === "fr"
      ? (item.label_fr as string | null) || (item.label as string)
      : (item.label as string)
    : "Document";
  return {
    storagePath: s.signed_file_path as string,
    filename: `${label || "Document"}.pdf`,
    mimeType: "application/pdf",
  };
}

export type ArchiveZipFile = {
  category: ArchiveCategoryKey;
  storagePath: string;
  // Final in-ZIP path (folder + leaf), already ASCII/de-collidable.
  path: string;
};

export type EngagementArchiveBundle = {
  engagementTitle: string;
  clientName: string;
  files: ArchiveZipFile[];
};

// Gather every archivable file for ONE engagement (all three categories),
// firm+client scoped, with each file's in-ZIP path resolved. Returns null if the
// engagement is out of scope; an empty files[] means the engagement has nothing
// to download.
export async function collectEngagementArchive(input: {
  firmId: string;
  clientId: string;
  engagementId: string;
  locale: AppLocale;
}): Promise<EngagementArchiveBundle | null> {
  const { firmId, clientId, engagementId, locale } = input;
  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select("id, title, client_id")
    .eq("id", engagementId)
    .eq("client_id", clientId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!engagement) return null;

  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", clientId)
    .maybeSingle();

  const [uploadedRes, sigRes, finalRes, itemRes] = await Promise.all([
    sb
      .from("uploaded_files")
      .select("storage_path, original_filename, display_name, is_duplicate, review_status")
      .eq("engagement_id", engagementId),
    sb
      .from("signature_requests")
      .select("signed_file_path, request_item_id")
      .eq("engagement_id", engagementId),
    sb
      .from("final_documents")
      .select("storage_path, original_filename, display_name")
      .eq("engagement_id", engagementId),
    sb.from("request_items").select("id, label, label_fr").eq("engagement_id", engagementId),
  ]);

  const itemLabel = new Map<string, string>();
  for (const it of itemRes.data ?? []) {
    itemLabel.set(
      it.id as string,
      (locale === "fr" ? (it.label_fr as string | null) || (it.label as string) : (it.label as string)) ?? "",
    );
  }

  const files: ArchiveZipFile[] = [];

  for (const f of uploadedRes.data ?? []) {
    if (f.is_duplicate || !f.storage_path) continue;
    const rejected = f.review_status === "rejected";
    files.push({
      category: "checklist",
      storagePath: f.storage_path as string,
      path: archiveEntryPath(
        "checklist",
        (f.display_name as string | null) ?? (f.original_filename as string),
        rejected,
        locale,
      ),
    });
  }

  for (const s of sigRes.data ?? []) {
    if (!s.signed_file_path) continue;
    const label = itemLabel.get(s.request_item_id as string) || "Document";
    files.push({
      category: "signed",
      storagePath: s.signed_file_path as string,
      path: archiveEntryPath("signed", `${label}.pdf`, false, locale),
    });
  }

  for (const d of finalRes.data ?? []) {
    if (!d.storage_path || isInvoiceAttachment(d.storage_path as string)) continue;
    files.push({
      category: "final",
      storagePath: d.storage_path as string,
      path: archiveEntryPath(
        "final",
        (d.display_name as string | null) ?? (d.original_filename as string),
        false,
        locale,
      ),
    });
  }

  return {
    engagementTitle: (engagement.title as string) ?? "",
    clientName: (client?.display_name as string | null) ?? "client",
    files,
  };
}
