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

// Signed PDFs carry no size in the DB; use a generous nominal size so the
// whole-client size cap still accounts for them.
const SIGNED_ESTIMATE_BYTES = 1_048_576;

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
// checklist files set apart under "<Checklist>/Rejected/<leaf>". When an
// engagementFolder is given (the whole-client ZIP), the whole thing is nested
// under it: "<Engagement>/<Category>/<leaf>". Pure + ASCII so it's stable across
// macOS/Windows/Linux unzip and safe to unit-test.
export function archiveEntryPath(
  category: ArchiveCategoryKey,
  rawName: string,
  rejected: boolean,
  locale: AppLocale,
  engagementFolder?: string,
): string {
  const folder = asciiFilePart(CATEGORY_FOLDER_LABEL[category][locale], 80) || "Documents";
  const leaf = macZipEntryName(rawName);
  const categoryPath =
    category === "checklist" && rejected ? `${folder}/Rejected/${leaf}` : `${folder}/${leaf}`;
  return engagementFolder ? `${engagementFolder}/${categoryPath}` : categoryPath;
}

export type ArchiveZipFile = {
  category: ArchiveCategoryKey;
  storagePath: string;
  // Final in-ZIP path (folder + leaf), already ASCII/de-collidable.
  path: string;
};

// Row shapes the pure builder consumes (a subset of each table's columns).
type UploadedZipRow = {
  storage_path: string | null;
  original_filename: string;
  display_name: string | null;
  is_duplicate: boolean;
  review_status: string;
  size_bytes: number | null;
};
type SignatureZipRow = { signed_file_path: string | null; request_item_id: string };
type FinalZipRow = {
  storage_path: string | null;
  original_filename: string;
  display_name: string | null;
  size_bytes: number | null;
};

// Pure: turn one engagement's three categories of rows into ZIP entries +
// an estimated byte total. Shared by the per-engagement and whole-client
// collectors so the layout/exclusion rules live in exactly one place.
export function buildEngagementZipFiles(input: {
  uploaded: UploadedZipRow[];
  signatures: SignatureZipRow[];
  finals: FinalZipRow[];
  itemLabel: Map<string, string>;
  locale: AppLocale;
  engagementFolder?: string;
}): { files: ArchiveZipFile[]; bytes: number } {
  const { uploaded, signatures, finals, itemLabel, locale, engagementFolder } = input;
  const files: ArchiveZipFile[] = [];
  let bytes = 0;

  for (const f of uploaded) {
    if (f.is_duplicate || !f.storage_path) continue;
    files.push({
      category: "checklist",
      storagePath: f.storage_path,
      path: archiveEntryPath(
        "checklist",
        f.display_name ?? f.original_filename,
        f.review_status === "rejected",
        locale,
        engagementFolder,
      ),
    });
    bytes += f.size_bytes ?? 0;
  }

  for (const s of signatures) {
    if (!s.signed_file_path) continue;
    const label = itemLabel.get(s.request_item_id) || "Document";
    files.push({
      category: "signed",
      storagePath: s.signed_file_path,
      path: archiveEntryPath("signed", `${label}.pdf`, false, locale, engagementFolder),
    });
    bytes += SIGNED_ESTIMATE_BYTES;
  }

  for (const d of finals) {
    if (!d.storage_path || isInvoiceAttachment(d.storage_path)) continue;
    files.push({
      category: "final",
      storagePath: d.storage_path,
      path: archiveEntryPath(
        "final",
        d.display_name ?? d.original_filename,
        false,
        locale,
        engagementFolder,
      ),
    });
    bytes += d.size_bytes ?? 0;
  }

  return { files, bytes };
}

// Build a per-engagement, collision-free ASCII folder name. Two engagements
// with the same title would otherwise merge into one folder in the client ZIP.
function uniqueFolder(title: string, used: Set<string>): string {
  const base = asciiFilePart(title, 80) || "Engagement";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base} (${n++})`;
  }
  used.add(candidate);
  return candidate;
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

function itemLabelMap(
  rows: Array<{ id: string; label: string; label_fr: string | null }> | null,
  locale: AppLocale,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of rows ?? []) {
    out.set(it.id, (locale === "fr" ? it.label_fr || it.label : it.label) ?? "");
  }
  return out;
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

export type ArchiveBundle = {
  archiveName: string; // suggested .zip filename (without extension logic)
  files: ArchiveZipFile[];
  estimatedBytes: number;
};

// Gather every archivable file for ONE engagement (all three categories),
// firm+client scoped. Files sit under "<Category>/..." (no engagement folder).
export async function collectEngagementArchive(input: {
  firmId: string;
  clientId: string;
  engagementId: string;
  locale: AppLocale;
}): Promise<ArchiveBundle | null> {
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
      .select("storage_path, original_filename, display_name, is_duplicate, review_status, size_bytes")
      .eq("engagement_id", engagementId),
    sb.from("signature_requests").select("signed_file_path, request_item_id").eq("engagement_id", engagementId),
    sb
      .from("final_documents")
      .select("storage_path, original_filename, display_name, size_bytes")
      .eq("engagement_id", engagementId),
    sb.from("request_items").select("id, label, label_fr").eq("engagement_id", engagementId),
  ]);

  const { files, bytes } = buildEngagementZipFiles({
    uploaded: (uploadedRes.data ?? []) as UploadedZipRow[],
    signatures: (sigRes.data ?? []) as SignatureZipRow[],
    finals: (finalRes.data ?? []) as FinalZipRow[],
    itemLabel: itemLabelMap(itemRes.data, locale),
    locale,
  });

  return {
    archiveName: `${asciiFilePart((engagement.title as string) ?? "")} - ${asciiFilePart(
      (client?.display_name as string | null) ?? "client",
    )}.zip`,
    files,
    estimatedBytes: bytes,
  };
}

// Gather every archivable file across ALL of a client's engagements, nested
// under one folder per engagement ("<Engagement>/<Category>/<file>"). Engagement
// folders are de-collided so two same-titled engagements never merge. Firm+client
// scoped. Batched: one query per source table across the whole client.
export async function collectClientArchive(input: {
  firmId: string;
  clientId: string;
  locale: AppLocale;
}): Promise<ArchiveBundle | null> {
  const { firmId, clientId, locale } = input;
  const sb = getServiceRoleSupabase();

  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", clientId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!client) return null;

  const clientName = (client.display_name as string | null) ?? "client";
  const archiveName = `${asciiFilePart(clientName)} - documents.zip`;

  const { data: engRows } = await sb
    .from("engagements")
    .select("id, title, created_at")
    .eq("client_id", clientId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const engagements = engRows ?? [];
  const engIds = engagements.map((e) => e.id as string);
  if (engIds.length === 0) {
    return { archiveName, files: [], estimatedBytes: 0 };
  }

  const [uploadedRes, sigRes, finalRes, itemRes] = await Promise.all([
    sb
      .from("uploaded_files")
      .select("engagement_id, storage_path, original_filename, display_name, is_duplicate, review_status, size_bytes")
      .in("engagement_id", engIds),
    sb
      .from("signature_requests")
      .select("engagement_id, signed_file_path, request_item_id")
      .in("engagement_id", engIds),
    sb
      .from("final_documents")
      .select("engagement_id, storage_path, original_filename, display_name, size_bytes")
      .in("engagement_id", engIds),
    sb.from("request_items").select("id, engagement_id, label, label_fr").in("engagement_id", engIds),
  ]);

  const groupBy = <T extends { engagement_id: string }>(rows: T[] | null): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) {
      const list = m.get(r.engagement_id) ?? [];
      list.push(r);
      m.set(r.engagement_id, list);
    }
    return m;
  };

  const uploadedByEng = groupBy(uploadedRes.data as (UploadedZipRow & { engagement_id: string })[] | null);
  const sigByEng = groupBy(sigRes.data as (SignatureZipRow & { engagement_id: string })[] | null);
  const finalByEng = groupBy(finalRes.data as (FinalZipRow & { engagement_id: string })[] | null);
  const itemLabel = itemLabelMap(itemRes.data, locale);

  const usedFolders = new Set<string>();
  const files: ArchiveZipFile[] = [];
  let estimatedBytes = 0;

  for (const e of engagements) {
    const engFolder = uniqueFolder((e.title as string) ?? "", usedFolders);
    const { files: engFiles, bytes } = buildEngagementZipFiles({
      uploaded: uploadedByEng.get(e.id as string) ?? [],
      signatures: sigByEng.get(e.id as string) ?? [],
      finals: finalByEng.get(e.id as string) ?? [],
      itemLabel,
      locale,
      engagementFolder: engFolder,
    });
    files.push(...engFiles);
    estimatedBytes += bytes;
  }

  return { archiveName, files, estimatedBytes };
}
