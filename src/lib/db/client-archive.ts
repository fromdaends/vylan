// Data layer for the per-CLIENT document archive: aggregates every document a
// client has exchanged across ALL of its engagements into one tree
// (CLIENT > ENGAGEMENT > CATEGORY > files). This is a READ/AGGREGATE layer on
// top of the existing per-engagement tables; it never changes how documents are
// stored.
//
// Three categories, each from its own table:
//   - checklist  → uploaded_files            (client uploads; no firm_id column,
//                                              RLS-scoped via engagement join)
//   - signed     → signature_requests        (completed e-signatures; firm_id)
//   - final      → final_documents           (returned deliverables; firm_id;
//                                              invoice attachments excluded)
//
// All reads go through the RLS-scoped session client (getServerSupabase), so a
// firm only ever sees its own client's documents — RLS enforces the firm
// boundary automatically (clients/engagements/final_documents/signature_requests
// scope on firm_id; uploaded_files/request_items scope via the engagement join).
// The whole aggregation degrades gracefully: a missing table (a migration not
// yet applied to this environment) or a transient per-category error yields an
// empty category rather than a 500, so the archive always renders.

import { getServerSupabase } from "@/lib/supabase/server";
import { getClient } from "@/lib/db/clients";
import type { AppLocale } from "@/lib/format";

export type ArchiveCategoryKey = "checklist" | "signed" | "final";

export type ArchiveFileStatus = "approved" | "pending" | "rejected";

export type ArchiveFile = {
  // Row id in its source table (uploaded_files / signature_requests /
  // final_documents). Phase 2 uses (category, id) to build the download link.
  id: string;
  category: ArchiveCategoryKey;
  name: string;
  date: string; // ISO timestamp
  // Checklist files carry the accountant's per-file review verdict; signed and
  // final files have no review status (null).
  status: ArchiveFileStatus | null;
  // True for an auto/accountant-rejected checklist file — the archive keeps
  // these but sets them apart (own subfolder in the ZIP; a "Rejected" chip in
  // the UI). Always false for signed/final.
  rejected: boolean;
  sizeBytes: number | null;
};

export type ArchiveCategoryGroup = {
  key: ArchiveCategoryKey;
  files: ArchiveFile[];
};

export type ArchiveEngagement = {
  id: string;
  title: string;
  type: string;
  status: string;
  archived: boolean;
  createdAt: string;
  dueDate: string | null;
  // Non-empty categories only, ordered checklist → signed → final.
  categories: ArchiveCategoryGroup[];
  fileCount: number;
};

export type ClientArchive = {
  client: {
    id: string;
    displayName: string;
    type: "individual" | "business";
  };
  engagements: ArchiveEngagement[]; // newest engagement first
  totalFiles: number;
};

// Ordered so the archive always lists categories the same way.
const CATEGORY_ORDER: ArchiveCategoryKey[] = ["checklist", "signed", "final"];

// Invoice PDFs live in the final_documents table but under a dedicated
// /invoices/ path and are deliberately NOT deliverables — mirror the exclusion
// used by listFinalDocumentsForEngagement so invoices never leak into the
// "Final documents" category.
function isInvoiceAttachment(path: string): boolean {
  return path.includes("/invoices/");
}

// PostgREST/Postgres signals that a table/column doesn't exist yet (a migration
// deployed in code but not applied to this environment). Treated as "no rows".
function isMissingSchema(err: { code?: string } | null): boolean {
  const code = err?.code;
  return code === "PGRST205" || code === "PGRST204" || code === "42P01" || code === "42703";
}

type CategoryQueryResult<T> = { data: T[] | null; error: { code?: string } | null };

// Soft-fail a per-category query: a missing table is silently empty; any other
// error is logged but still degraded to empty so one bad category can't take
// down the whole archive.
function softRows<T>(label: string, res: CategoryQueryResult<T>): T[] {
  if (res.error) {
    if (!isMissingSchema(res.error)) {
      console.error(`[client-archive] ${label} query failed:`, res.error);
    }
    return [];
  }
  return res.data ?? [];
}

function byDateDesc(a: { date: string }, b: { date: string }): number {
  return b.date.localeCompare(a.date);
}

export type UploadedRow = {
  id: string;
  engagement_id: string;
  original_filename: string;
  display_name: string | null;
  is_duplicate: boolean;
  review_status: ArchiveFileStatus;
  uploaded_at: string;
  size_bytes: number | null;
  storage_path: string | null;
};

export type SignatureRow = {
  id: string;
  engagement_id: string;
  request_item_id: string;
  signed_file_path: string | null;
  completed_at: string | null;
  created_at: string;
};

export type FinalRow = {
  id: string;
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  display_name: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type ItemRow = { id: string; label: string; label_fr: string | null };

export type EngagementMetaRow = {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  archived_at: string | null;
  created_at: string;
  due_date: string | null;
};

// Pure assembly of the archive tree from already-fetched, already-firm-scoped
// rows. Kept side-effect-free so it can be unit-tested without a database:
// buckets each file under its engagement + category, drops what shouldn't be
// archived (duplicate uploads, unsent signatures, invoice attachments), and
// orders engagements newest-first / files newest-first.
export function buildClientArchive(input: {
  client: { id: string; displayName: string; type: "individual" | "business" };
  engagements: EngagementMetaRow[]; // already ordered newest-first
  uploaded: UploadedRow[];
  signatures: SignatureRow[];
  finals: FinalRow[];
  items: ItemRow[];
  locale: AppLocale;
}): ClientArchive {
  const { client, engagements, uploaded, signatures, finals, items, locale } = input;

  const itemLabel = new Map<string, string>();
  for (const it of items) {
    itemLabel.set(it.id, (locale === "fr" ? it.label_fr || it.label : it.label) ?? "");
  }

  const checklistByEng = new Map<string, ArchiveFile[]>();
  const signedByEng = new Map<string, ArchiveFile[]>();
  const finalByEng = new Map<string, ArchiveFile[]>();

  for (const f of uploaded) {
    // Ignore exact-duplicate re-uploads and rows whose object never landed.
    if (f.is_duplicate || !f.storage_path) continue;
    const list = checklistByEng.get(f.engagement_id) ?? [];
    list.push({
      id: f.id,
      category: "checklist",
      name: f.display_name ?? f.original_filename,
      date: f.uploaded_at,
      status: f.review_status,
      rejected: f.review_status === "rejected",
      sizeBytes: f.size_bytes,
    });
    checklistByEng.set(f.engagement_id, list);
  }

  for (const s of signatures) {
    // Only completed signatures have a stored PDF to archive.
    if (!s.signed_file_path) continue;
    const list = signedByEng.get(s.engagement_id) ?? [];
    list.push({
      id: s.id,
      category: "signed",
      name: itemLabel.get(s.request_item_id) || "Document",
      date: s.completed_at ?? s.created_at,
      status: null,
      rejected: false,
      sizeBytes: null,
    });
    signedByEng.set(s.engagement_id, list);
  }

  for (const d of finals) {
    if (isInvoiceAttachment(d.storage_path)) continue;
    const list = finalByEng.get(d.engagement_id) ?? [];
    list.push({
      id: d.id,
      category: "final",
      name: d.display_name ?? d.original_filename,
      date: d.created_at,
      status: null,
      rejected: false,
      sizeBytes: d.size_bytes,
    });
    finalByEng.set(d.engagement_id, list);
  }

  const filesFor: Record<ArchiveCategoryKey, Map<string, ArchiveFile[]>> = {
    checklist: checklistByEng,
    signed: signedByEng,
    final: finalByEng,
  };

  let totalFiles = 0;
  const outEngagements: ArchiveEngagement[] = engagements.map((e) => {
    const categories: ArchiveCategoryGroup[] = [];
    let fileCount = 0;
    for (const key of CATEGORY_ORDER) {
      const files = (filesFor[key].get(e.id) ?? []).slice().sort(byDateDesc);
      if (files.length > 0) {
        categories.push({ key, files });
        fileCount += files.length;
      }
    }
    totalFiles += fileCount;
    return {
      id: e.id,
      title: e.title ?? "",
      type: e.type ?? "",
      status: e.status ?? "",
      archived: e.archived_at != null,
      createdAt: e.created_at,
      dueDate: e.due_date,
      categories,
      fileCount,
    };
  });

  return { client, engagements: outEngagements, totalFiles };
}

// Build the whole archive tree for one client. Returns null when the client
// doesn't exist for this firm (getClient is RLS-scoped) so the caller can 404.
export async function getClientArchive(
  clientId: string,
  locale: AppLocale,
): Promise<ClientArchive | null> {
  const client = await getClient(clientId);
  if (!client) return null;

  const supabase = await getServerSupabase();

  const clientSummary = {
    id: client.id,
    displayName: client.display_name,
    type: client.type,
  };

  // Every engagement over the client's history: active AND archived, but not
  // soft-deleted (30-day recycle bin). RLS scopes to the firm.
  const { data: engRows, error: engErr } = await supabase
    .from("engagements")
    .select("id, title, type, status, archived_at, created_at, due_date")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (engErr) throw engErr;

  const engagements = (engRows ?? []) as EngagementMetaRow[];
  const engIds = engagements.map((e) => e.id);

  if (engIds.length === 0) {
    return { client: clientSummary, engagements: [], totalFiles: 0 };
  }

  // One batched read per source table (each indexed on engagement_id), plus the
  // checklist-item labels used to name signed documents (which have no filename
  // of their own). All firm-scoped by RLS through the session client.
  const [uploadedRes, sigRes, finalRes, itemRes] = await Promise.all([
    supabase
      .from("uploaded_files")
      .select(
        "id, engagement_id, original_filename, display_name, is_duplicate, review_status, uploaded_at, size_bytes, storage_path",
      )
      .in("engagement_id", engIds),
    supabase
      .from("signature_requests")
      .select("id, engagement_id, request_item_id, signed_file_path, completed_at, created_at")
      .in("engagement_id", engIds),
    supabase
      .from("final_documents")
      .select("id, engagement_id, storage_path, original_filename, display_name, size_bytes, created_at")
      .in("engagement_id", engIds),
    supabase.from("request_items").select("id, label, label_fr").in("engagement_id", engIds),
  ]);

  return buildClientArchive({
    client: clientSummary,
    engagements,
    uploaded: softRows<UploadedRow>("uploaded_files", uploadedRes),
    signatures: softRows<SignatureRow>("signature_requests", sigRes),
    finals: softRows<FinalRow>("final_documents", finalRes),
    items: softRows<ItemRow>("request_items", itemRes),
    locale,
  });
}
