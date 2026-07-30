// Data layer for the FILES section — the firm-wide document browser.
//
// Everything reads the `firm_documents` view (migration 1070), which unions the
// three places a document can live: checklist uploads, the firm's own final
// deliverables, and imported historical files. Reading one relation rather than
// three is what makes filter + sort + search + PAGE a single SQL query; merging
// three result sets in Node cannot be paginated correctly at all.
//
// SECURITY: every read here goes through the RLS session client, never the
// service role. That is deliberate and load-bearing. The Phase 0 audit found
// that document visibility is already narrower than "everyone sees everything"
// — private clients (0810) and private engagements (0850) are hidden from staff
// unless they are assigned (0990) — and the view inherits all of it through
// security_invoker. Reaching for the service role "to see everything" here
// would silently punch a hole through all three migrations.
//
// GATED like every post-launch table (dev + previews point at the prod DB):
// a missing view/column/function reads as "Files not set up yet" via error-code
// checks only (the 0650 rule), so the section stays dormant rather than
// throwing if it ever runs somewhere 1070/1080 has not been applied.

import { getServerSupabase } from "@/lib/supabase/server";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import type { DocType } from "@/lib/db/templates";
import { resolveDocType, type BrowseCategory } from "@/lib/files/axes";
import { ANALYSIS_FRESH_MS } from "@/lib/engagements/file-ai-headline";

// PGRST205 = table/view missing from the schema cache, 42P01 = undefined table,
// PGRST204 / 42703 = missing column, PGRST202 = function not found (1080).
export function isFilesSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    err?.code === "PGRST202"
  );
}

export type DocumentSource = "checklist" | "final" | "imported";

export type ReviewStatus = "pending" | "approved" | "rejected";

/** One row as the browser renders it — raw columns already resolved. */
export type BrowseDocument = {
  source: DocumentSource;
  id: string;
  clientId: string;
  engagementId: string | null;
  storagePath: string;
  /** display_name ?? original_filename — what every other surface shows. */
  name: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Manual type wins over the model's; null = we do not know what this is. */
  docType: DocType | null;
  docTypeIsManual: boolean;
  year: number | null;
  category: BrowseCategory | null;
  /** Null for deliverables and imports — they have nothing to approve. */
  reviewStatus: ReviewStatus | null;
  isDuplicate: boolean;
  createdAt: string;
  deletedAt: string | null;
  /**
   * The AI is still reading this one RIGHT NOW. Move is disabled while this is
   * true (the classification is about to overwrite the axes anyway), which is
   * exactly why it has to mean "in flight" and not merely "has no type".
   *
   * Two ways a document can have no type forever, and neither is pending:
   *
   *   * An IMPORTED document. By the founder's decision imports skip the AI
   *     entirely, so hand-sorting is the whole point of them.
   *   * A checklist upload the AI never ran on — the firm has AI off, it hit a
   *     rate limit, or the job died. Past ANALYSIS_FRESH_MS the product already
   *     treats an un-run analysis as "never ran" rather than in-flight, and
   *     this uses the same constant.
   *
   * Get this wrong in either direction and the file shows a spinner that never
   * resolves while its Move button stays greyed out — permanently unsortable.
   */
  classificationPending: boolean;
  /** Filled in by the caller that needs it; see attachEngagementContext. */
  engagementTitle?: string | null;
  engagementDeleted?: boolean;
};

type ViewRow = {
  source: string;
  id: string;
  client_id: string;
  engagement_id: string | null;
  storage_path: string;
  original_filename: string;
  display_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  manual_doc_type: string | null;
  browse_year: number | null;
  browse_category: string | null;
  review_status: string | null;
  is_duplicate: boolean | null;
  deleted_at: string | null;
  created_at: string;
};

const VIEW_COLUMNS =
  "source, id, client_id, engagement_id, storage_path, original_filename, display_name, mime_type, size_bytes, ai_doc_type, ai_confidence, manual_doc_type, browse_year, browse_category, review_status, is_duplicate, deleted_at, created_at";

/**
 * Is the AI still reading this document right now?
 *
 * Pure and exported so the rule is testable — it decides whether Move is
 * available, so "no type yet" and "no type, ever" must not be confused.
 *
 * `now` is a parameter rather than a Date.now() call inside so tests can pin it.
 */
export function isClassificationPending(
  doc: {
    source: DocumentSource;
    aiDocType: string | null;
    manualDocType: string | null;
    createdAt: string;
  },
  now: number = Date.now(),
): boolean {
  // Imports never go near the model, and a hand-set type means somebody already
  // answered the question the model was going to answer.
  if (doc.source !== "checklist") return false;
  if (doc.aiDocType != null || doc.manualDocType != null) return false;
  const uploadedAt = new Date(doc.createdAt).getTime();
  if (!Number.isFinite(uploadedAt)) return false;
  // Past the freshness window an un-run analysis is treated as never having
  // run — the same rule the engagement page's AI headline already applies.
  return now - uploadedAt < ANALYSIS_FRESH_MS;
}

function toBrowseDocument(row: ViewRow): BrowseDocument {
  const source = row.source as DocumentSource;
  const resolved = resolveDocType({
    manualDocType: row.manual_doc_type,
    aiDocType: row.ai_doc_type,
    aiConfidence: row.ai_confidence,
  });
  return {
    source,
    id: row.id,
    clientId: row.client_id,
    engagementId: row.engagement_id,
    storagePath: row.storage_path,
    name: row.display_name?.trim() || row.original_filename,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    docType: resolved.code,
    docTypeIsManual: resolved.manual,
    year: row.browse_year,
    category: (row.browse_category as BrowseCategory | null) ?? null,
    reviewStatus: (row.review_status as ReviewStatus | null) ?? null,
    isDuplicate: row.is_duplicate === true,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    classificationPending: isClassificationPending({
      source,
      aiDocType: row.ai_doc_type,
      manualDocType: row.manual_doc_type,
      createdAt: row.created_at,
    }),
  };
}

// ── Level 1: the client folders ─────────────────────────────────────────────

export type ClientFolder = {
  clientId: string;
  name: string;
  clientType: "individual" | "business";
  documentCount: number;
  lastActivity: string | null;
};

export type ClientFolderPage = {
  folders: ClientFolder[];
  total: number;
  /** False = migration 1070/1080 not applied; the section renders dormant. */
  available: boolean;
};

export const FOLDERS_PER_PAGE = 60;

/**
 * The Files landing view: every client that HAS documents, as a folder.
 *
 * Goes through the firm_document_folders RPC because count-per-client and
 * max(date)-per-client are aggregates, and this project has PostgREST
 * aggregates disabled. The function is SECURITY INVOKER over the same RLS —
 * see migration 1080.
 */
export async function listClientFolders(opts: {
  search?: string | null;
  page?: number;
}): Promise<ClientFolderPage> {
  const page = Math.max(1, opts.page ?? 1);
  const sb = await getServerSupabase();
  const { data, error } = await sb.rpc("firm_document_folders", {
    p_search: opts.search?.trim() || null,
    p_limit: FOLDERS_PER_PAGE,
    p_offset: (page - 1) * FOLDERS_PER_PAGE,
  });
  if (error) {
    if (!isFilesSchemaMissing(error)) {
      console.error("[files] folder list failed:", error.message);
    }
    return { folders: [], total: 0, available: !isFilesSchemaMissing(error) };
  }
  const rows = (data ?? []) as Array<{
    client_id: string;
    display_name: string;
    client_type: string;
    document_count: number | string;
    last_activity: string | null;
    total_count: number | string;
  }>;
  return {
    folders: rows.map((r) => ({
      clientId: r.client_id,
      name: r.display_name,
      clientType: r.client_type === "business" ? "business" : "individual",
      // bigint arrives as a string over PostgREST when it exceeds 2^53; Number
      // is safe for a document count and keeps the UI types simple.
      documentCount: Number(r.document_count) || 0,
      lastActivity: r.last_activity,
    })),
    total: rows.length > 0 ? Number(rows[0].total_count) || 0 : 0,
    available: true,
  };
}

// ── Level 2: one client's year → category tree ──────────────────────────────

export type CategoryGroup = {
  category: BrowseCategory | null;
  count: number;
  /** Most recent document in this folder — the "Modified" column. */
  lastActivity: string | null;
};

export type YearGroup = {
  /** Null = the "Unsorted" bucket (no detectable year). */
  year: number | null;
  count: number;
  lastActivity: string | null;
  categories: CategoryGroup[];
};

/**
 * One client's year → category folder structure.
 *
 * Grouped in Node rather than SQL, and that is a deliberate limit rather than
 * an oversight: the set is ONE client's documents, which is bounded by how much
 * work a firm does for a single client — hundreds, not the firm-wide thousands
 * the landing page had to worry about. Only three small columns are fetched, so
 * even a heavy client is a few kilobytes.
 */
export async function getClientDocumentTree(clientId: string): Promise<{
  years: YearGroup[];
  total: number;
  available: boolean;
}> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_documents")
    .select("browse_year, browse_category, created_at")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    if (!isFilesSchemaMissing(error)) {
      console.error("[files] client tree failed:", error.message);
    }
    return { years: [], total: 0, available: !isFilesSchemaMissing(error) };
  }
  const rows = (data ?? []) as Array<{
    browse_year: number | null;
    browse_category: string | null;
    created_at: string;
  }>;
  return { years: groupDocumentAxes(rows), total: rows.length, available: true };
}

/**
 * Fold raw (year, category, date) rows into the folder structure the browser
 * renders. Pure, so the ordering rules below are testable without a database —
 * and they matter: "newest year first, Unsorted last" is the difference between
 * an accountant landing on this year's work and landing on a pile of files the
 * AI could not date.
 *
 * Each folder carries the date of the newest document inside it, which is what
 * a file manager's "Modified" column means for a folder.
 */
export function groupDocumentAxes(
  rows: Array<{
    browse_year: number | null;
    browse_category: string | null;
    created_at?: string | null;
  }>,
): YearGroup[] {
  const byYear = new Map<
    number | null,
    Map<string | null, { count: number; last: string | null }>
  >();
  const newer = (a: string | null, b: string | null | undefined) =>
    !b ? a : !a ? b : b > a ? b : a;

  for (const r of rows) {
    const y = r.browse_year ?? null;
    if (!byYear.has(y)) byYear.set(y, new Map());
    const cats = byYear.get(y)!;
    const c = r.browse_category ?? null;
    const prev = cats.get(c) ?? { count: 0, last: null };
    cats.set(c, {
      count: prev.count + 1,
      last: newer(prev.last, r.created_at),
    });
  }

  const years: YearGroup[] = [...byYear.entries()]
    .map(([year, cats]) => ({
      year,
      count: [...cats.values()].reduce((a, b) => a + b.count, 0),
      lastActivity: [...cats.values()].reduce<string | null>(
        (acc, c) => newer(acc, c.last),
        null,
      ),
      categories: [...cats.entries()]
        .map(([category, v]) => ({
          category: (category as BrowseCategory | null) ?? null,
          count: v.count,
          lastActivity: v.last,
        }))
        // Unsorted last within a year; named categories alphabetical by code so
        // the order is stable across locales (labels are translated at render).
        .sort((a, b) => {
          if (a.category === b.category) return 0;
          if (a.category === null) return 1;
          if (b.category === null) return -1;
          return a.category.localeCompare(b.category);
        }),
    }))
    // Newest year first; the Unsorted year sinks to the bottom.
    .sort((a, b) => {
      if (a.year === b.year) return 0;
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });

  return years;
}

// ── Level 3: the paginated file list ────────────────────────────────────────

export type DocumentSort = "date" | "name" | "size";

export type DocumentFilters = {
  clientId?: string | null;
  /** undefined = any year; null = the Unsorted bucket specifically. */
  year?: number | null;
  category?: BrowseCategory | null;
  yearSet?: boolean;
  categorySet?: boolean;
  docTypes?: DocType[];
  statuses?: ReviewStatus[];
  search?: string | null;
  sort?: DocumentSort;
  page?: number;
  /** True = the Recently deleted view. */
  deleted?: boolean;
};

export type DocumentPage = {
  documents: BrowseDocument[];
  total: number;
  page: number;
  pageCount: number;
  available: boolean;
};

export const DOCUMENTS_PER_PAGE = 50;

/**
 * Which doc-type codes a free-text search should match, by their bilingual
 * labels — so typing "relevé" or "slip" finds documents by TYPE, not just by
 * filename. Pure string work over the in-memory label map; no query.
 */
export function docTypeCodesMatching(search: string): DocType[] {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  const out: DocType[] = [];
  for (const [code, meta] of Object.entries(DOC_TYPE_LABELS)) {
    if (
      code.toLowerCase().includes(q) ||
      meta.en.toLowerCase().includes(q) ||
      meta.fr.toLowerCase().includes(q)
    ) {
      out.push(code as DocType);
    }
  }
  return out;
}

/** PostgREST `or=` values are comma-separated, so a comma or paren in user
 * input would break out of the filter expression. Strip rather than escape:
 * these characters carry no meaning in a filename search. */
function sanitizeForOr(input: string): string {
  return input.replace(/[,()]/g, " ").trim();
}

/**
 * One page of documents. Filtering, searching, sorting and paging all happen in
 * SQL — the spec assumes thousands of documents per firm, and anything that
 * loads the full set to slice it in Node would fall over exactly when a firm
 * gets big enough to need this screen.
 */
export async function listDocuments(
  filters: DocumentFilters,
): Promise<DocumentPage> {
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * DOCUMENTS_PER_PAGE;
  const sb = await getServerSupabase();

  let q = sb
    .from("firm_documents")
    .select(VIEW_COLUMNS, { count: "exact" });

  // Soft-deleted documents are excluded from EVERY view except the recycle bin
  // itself — the spec is explicit that they must not appear in browse, search,
  // or any storage re-filing job.
  q = filters.deleted
    ? q.not("deleted_at", "is", null)
    : q.is("deleted_at", null);

  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  // yearSet distinguishes "any year" from "the Unsorted bucket". Without it,
  // a null year is indistinguishable from no filter at all and the Unsorted
  // folder would silently show everything.
  if (filters.yearSet) {
    q = filters.year == null ? q.is("browse_year", null) : q.eq("browse_year", filters.year);
  }
  if (filters.categorySet) {
    q =
      filters.category == null
        ? q.is("browse_category", null)
        : q.eq("browse_category", filters.category);
  }
  if (filters.statuses?.length) q = q.in("review_status", filters.statuses);
  if (filters.docTypes?.length) {
    // A manual type overrides the model's, so a type filter has to match
    // either column — otherwise hand-typed documents vanish from their own
    // filter.
    const list = filters.docTypes.join(",");
    q = q.or(`manual_doc_type.in.(${list}),ai_doc_type.in.(${list})`);
  }

  const search = sanitizeForOr(filters.search ?? "");
  if (search) {
    const clauses = [
      `display_name.ilike.%${search}%`,
      `original_filename.ilike.%${search}%`,
    ];
    const typeCodes = docTypeCodesMatching(search);
    if (typeCodes.length) {
      clauses.push(`manual_doc_type.in.(${typeCodes.join(",")})`);
      clauses.push(`ai_doc_type.in.(${typeCodes.join(",")})`);
    }
    // Client-name search is resolved to ids first: the view carries client_id,
    // not the name, and joining the name in would cost a join on every page.
    const { data: matched } = await sb
      .from("clients")
      .select("id")
      .ilike("display_name", `%${search}%`)
      .limit(200);
    const ids = ((matched ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (ids.length) clauses.push(`client_id.in.(${ids.join(",")})`);
    q = q.or(clauses.join(","));
  }

  switch (filters.sort ?? "date") {
    case "name":
      // original_filename is the tiebreak because display_name is null until
      // the AI names a file, and nulls would otherwise clump unpredictably.
      q = q.order("display_name", { ascending: true, nullsFirst: false })
           .order("original_filename", { ascending: true });
      break;
    case "size":
      q = q.order("size_bytes", { ascending: false, nullsFirst: false });
      break;
    default:
      q = q.order("created_at", { ascending: false });
  }
  // Stable tiebreak: without it, two documents sharing a timestamp can swap
  // places between pages and one of them is never seen.
  q = q.order("id", { ascending: true });

  const { data, error, count } = await q.range(from, from + DOCUMENTS_PER_PAGE - 1);
  if (error) {
    if (!isFilesSchemaMissing(error)) {
      console.error("[files] document list failed:", error.message);
    }
    return {
      documents: [],
      total: 0,
      page,
      pageCount: 0,
      available: !isFilesSchemaMissing(error),
    };
  }
  const total = count ?? 0;
  return {
    documents: ((data ?? []) as unknown as ViewRow[]).map(toBrowseDocument),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / DOCUMENTS_PER_PAGE)),
    available: true,
  };
}

/**
 * Attach each document's source engagement title, and whether that engagement
 * has been deleted.
 *
 * The spec requires a file whose engagement was deleted to STILL APPEAR, with
 * "engagement deleted" where the link would be — so this deliberately does not
 * filter deleted engagements out, it labels them. Imported documents have no
 * engagement at all and are simply left alone.
 *
 * One extra query per page rather than a join in the view: the join would run
 * on every document read in the product, and this is only needed by the table.
 */
export async function attachEngagementContext(
  documents: BrowseDocument[],
): Promise<BrowseDocument[]> {
  const ids = [
    ...new Set(documents.map((d) => d.engagementId).filter((v): v is string => !!v)),
  ];
  if (ids.length === 0) return documents;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("engagements")
    .select("id, title, deleted_at")
    .in("id", ids);
  if (error) return documents;
  const map = new Map(
    ((data ?? []) as Array<{ id: string; title: string | null; deleted_at: string | null }>).map(
      (e) => [e.id, e],
    ),
  );
  return documents.map((d) => {
    if (!d.engagementId) return d;
    const eng = map.get(d.engagementId);
    return {
      ...d,
      // Absent from the result set means RLS hid it (a private engagement this
      // viewer cannot see) OR it was hard-purged. Either way there is no link
      // to offer, and the row still renders.
      engagementTitle: eng?.title ?? null,
      engagementDeleted: eng ? eng.deleted_at != null : true,
    };
  });
}

/** The client's own name + type, for the breadcrumb and the cross-link. */
export async function getClientHeader(clientId: string): Promise<{
  id: string;
  name: string;
  clientType: "individual" | "business";
} | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("clients")
    .select("id, display_name, type")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    name: (data.display_name as string) ?? "",
    clientType: data.type === "business" ? "business" : "individual",
  };
}
