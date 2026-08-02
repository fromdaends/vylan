// AI ORGANIZE — the scanner (Files v2 §3).
//
// Runs nightly and on demand, READS ONLY, and writes suggestions to
// organize_suggestions for a human to approve. The hard rule: the AI never
// moves, renames, or deletes anything on its own — approvals execute through
// the same server actions as manual work, attributed to the approving user.
//
// Division of labor (founder ruling 2026-08-02):
//   Luna (text, cheap)  — reads file NAMES: proposes types for unprocessed
//                         and low-confidence files, catches years the name
//                         contradicts. Never sees document content.
//   No model at all     — misfiled categories (the trusted type already
//                         implies the category; comparing is arithmetic) and
//                         duplicates (content_hash equality).
//   Terra               — NOT USED HERE. Terra analyzes documents at intake,
//                         and that is the only thing Terra does.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  organizeWithLuna,
  type LunaFile,
  type LunaProposal,
} from "@/lib/ai/openai-classify";
import { categoryForDocType, resolveDocType } from "@/lib/files/axes";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import { ANALYSIS_FRESH_MS } from "@/lib/engagements/file-ai-headline";

export type OrganizeBucket =
  | "low_confidence"
  | "misfile"
  | "duplicate"
  | "unprocessed"
  // A file whose NAME matches one of the folders the firm created for that
  // client ("Hydro bill.pdf" → "Bookkeeping & business"). Founder direction:
  // organize into created folders too, not just the year/category structure.
  | "filing";

/** Below this intake confidence a classification counts as "low". */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Per-firm caps per run. Logged when hit — a silent cap reads as "covered
 * everything" when it didn't. */
export const MAX_DOCS_PER_FIRM = 2000;
export const MAX_LUNA_FILES_PER_RUN = 200;
const LUNA_BATCH = 40;

/** The document fields a suggestion is ABOUT. Stored as current_state and
 * re-checked at approval time: if the document changed since the scan, the
 * suggestion refuses to fire. */
export type DocState = {
  name: string;
  doc_type: string | null;
  year: number | null;
  category: string | null;
  folder_id: string | null;
};

export type ScanRow = {
  source: string;
  id: string;
  firm_id: string;
  client_id: string;
  name: string;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  manual_doc_type: string | null;
  browse_year: number | null;
  browse_category: string | null;
  folder_id: string | null;
  content_hash: string | null;
  created_at: string;
};

export type SuggestionInsert = {
  firm_id: string;
  client_id: string;
  source: string;
  document_id: string;
  bucket: OrganizeBucket;
  current_state: DocState;
  proposed_state: Record<string, unknown>;
  reasoning: string | null;
  keep_source?: string | null;
  keep_document_id?: string | null;
};

export function stateOf(row: ScanRow): DocState {
  const resolved = resolveDocType({
    manualDocType: row.manual_doc_type,
    aiDocType: row.ai_doc_type,
    aiConfidence: row.ai_confidence,
  });
  return {
    name: row.name,
    doc_type: resolved.code,
    year: row.browse_year,
    category: row.browse_category,
    folder_id: row.folder_id,
  };
}

/** Does the stored suggestion still describe this document? Approval and the
 * next scan both use this — a stale suggestion expires instead of firing. */
export function stateMatches(stored: unknown, row: ScanRow): boolean {
  if (!stored || typeof stored !== "object") return false;
  const s = stored as Partial<DocState>;
  const now = stateOf(row);
  return (
    s.name === now.name &&
    (s.doc_type ?? null) === now.doc_type &&
    (s.year ?? null) === now.year &&
    (s.category ?? null) === now.category &&
    (s.folder_id ?? null) === now.folder_id
  );
}

/** MISFILE, the deterministic half: the document's trusted type implies a
 * category; if the row sits in a different one (and no human pinned it — the
 * manual flag is checked by the CALLER, which fetched it), propose the fix.
 * Pure arithmetic over data the intake pipeline already produced. */
export function categoryMisfile(row: ScanRow): { category: string } | null {
  const resolved = resolveDocType({
    manualDocType: row.manual_doc_type,
    aiDocType: row.ai_doc_type,
    aiConfidence: row.ai_confidence,
  });
  if (!resolved.code) return null;
  const expected = categoryForDocType(resolved.code);
  if (!expected || expected === row.browse_category) return null;
  return { category: expected };
}

/** DUPLICATES: same client, same content hash. Keep the newest copy, propose
 * soft-deleting the rest. Pure. */
export function duplicateSuggestions(rows: ScanRow[]): SuggestionInsert[] {
  const groups = new Map<string, ScanRow[]>();
  for (const r of rows) {
    if (!r.content_hash) continue;
    const key = `${r.client_id}|${r.content_hash}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: SuggestionInsert[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const keeper = sorted[0];
    for (const dupe of sorted.slice(1)) {
      out.push({
        firm_id: dupe.firm_id,
        client_id: dupe.client_id,
        source: dupe.source,
        document_id: dupe.id,
        bucket: "duplicate",
        current_state: stateOf(dupe),
        proposed_state: { action: "soft_delete" },
        reasoning: null,
        keep_source: keeper.source,
        keep_document_id: keeper.id,
      });
    }
  }
  return out;
}

/** Which files Luna should look at, and under which bucket. */
export function lunaCandidates(rows: ScanRow[], now = Date.now()) {
  const unprocessed: ScanRow[] = [];
  const lowConfidence: ScanRow[] = [];
  for (const r of rows) {
    if (r.manual_doc_type) continue; // a human already answered
    if (r.source === "checklist") {
      if (r.ai_doc_type == null) {
        // No verdict and past the freshness window = the analysis never ran.
        const age = now - new Date(r.created_at).getTime();
        if (Number.isFinite(age) && age > ANALYSIS_FRESH_MS) unprocessed.push(r);
      } else if ((r.ai_confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD) {
        lowConfidence.push(r);
      }
    } else if (r.source === "imported" && r.ai_doc_type == null) {
      // Imports never went near a model by design; Luna reading their NAMES
      // is exactly the founder's stated use for it.
      unprocessed.push(r);
    }
  }
  return { unprocessed, lowConfidence };
}

/** Per-client folder lookup: lowercased name → folder id, or null when two
 * folders share a name (different levels can) — ambiguity means no proposal. */
export type FolderIdByName = Map<string, string | null>;

export function buildFolderIndex(
  folders: Array<{ id: string; name: string }>,
): { names: string[]; idByName: FolderIdByName } {
  const idByName: FolderIdByName = new Map();
  const names: string[] = [];
  for (const f of folders) {
    names.push(f.name);
    const key = f.name.trim().toLowerCase();
    idByName.set(key, idByName.has(key) ? null : f.id);
  }
  return { names, idByName };
}

/** Turn Luna's answers into suggestion rows. Null doc_type = Luna was not
 * sure = no suggestion, never a guess. A year that contradicts the row's
 * (non-manual, checked by caller) year becomes a misfile suggestion even
 * when the type already matched. A matched FOLDER rides along on any of
 * them; on its own it becomes a "filing" suggestion — and for filing-pool
 * rows (already well-typed) the folder is the ONLY thing considered, because
 * their type is settled and not Luna's to reopen. */
export function proposalsToSuggestions(
  proposals: LunaProposal[],
  byId: Map<string, { row: ScanRow; bucket: OrganizeBucket }>,
  folderIdByName: FolderIdByName = new Map(),
): SuggestionInsert[] {
  const out: SuggestionInsert[] = [];
  for (const p of proposals) {
    const hit = byId.get(p.id);
    if (!hit) continue;
    const { row, bucket } = hit;
    const validType =
      p.doc_type && p.doc_type in DOC_TYPE_LABELS
        ? (p.doc_type as keyof typeof DOC_TYPE_LABELS)
        : null;
    const proposedYear =
      p.year != null && p.year >= 1990 && p.year <= 2100 ? p.year : null;

    // Resolve the folder Luna named, if any: unknown or ambiguous names
    // resolve to nothing, and a folder the file is already in is not a move.
    let folderPatch: { folder_id: string; folder_name: string } | null = null;
    if (p.folder) {
      const id = folderIdByName.get(p.folder.trim().toLowerCase());
      if (id && id !== row.folder_id) {
        folderPatch = { folder_id: id, folder_name: p.folder.trim() };
      }
    }

    if (bucket === "filing") {
      if (!folderPatch) continue;
      out.push({
        firm_id: row.firm_id,
        client_id: row.client_id,
        source: row.source,
        document_id: row.id,
        bucket: "filing",
        current_state: stateOf(row),
        proposed_state: folderPatch,
        reasoning: p.reason?.slice(0, 300) || null,
      });
      continue;
    }

    if (validType) {
      out.push({
        firm_id: row.firm_id,
        client_id: row.client_id,
        source: row.source,
        document_id: row.id,
        bucket,
        current_state: stateOf(row),
        proposed_state: {
          doc_type: validType,
          category: categoryForDocType(validType) ?? null,
          year: proposedYear ?? row.browse_year,
          ...(folderPatch ?? {}),
        },
        reasoning: p.reason?.slice(0, 300) || null,
      });
    } else if (proposedYear != null && proposedYear !== row.browse_year) {
      out.push({
        firm_id: row.firm_id,
        client_id: row.client_id,
        source: row.source,
        document_id: row.id,
        bucket: "misfile",
        current_state: stateOf(row),
        proposed_state: { year: proposedYear, ...(folderPatch ?? {}) },
        reasoning: p.reason?.slice(0, 300) || null,
      });
    } else if (folderPatch) {
      out.push({
        firm_id: row.firm_id,
        client_id: row.client_id,
        source: row.source,
        document_id: row.id,
        bucket: "filing",
        current_state: stateOf(row),
        proposed_state: folderPatch,
        reasoning: p.reason?.slice(0, 300) || null,
      });
    }
  }
  return out;
}

export type ScanResult = {
  firms: number;
  scanned: number;
  created: Record<OrganizeBucket, number>;
  expired: number;
  lunaFiles: number;
  truncated: boolean;
};

/**
 * The scan. Service-role reads (this runs from the cron with no session), so
 * `deleted_at is null` is filtered EXPLICITLY — RLS does that for sessions,
 * not for us. Respecting the recycle bin is a spec requirement, not a nicety.
 */
export async function runOrganizeScan(opts: { firmId?: string } = {}): Promise<ScanResult> {
  const sb = getServiceRoleSupabase();
  const result: ScanResult = {
    firms: 0,
    scanned: 0,
    created: { low_confidence: 0, misfile: 0, duplicate: 0, unprocessed: 0, filing: 0 },
    expired: 0,
    lunaFiles: 0,
    truncated: false,
  };

  let firmIds: string[];
  if (opts.firmId) {
    firmIds = [opts.firmId];
  } else {
    const { data } = await sb.from("firms").select("id");
    firmIds = ((data ?? []) as Array<{ id: string }>).map((f) => f.id);
  }

  for (const firmId of firmIds) {
    result.firms++;

    const { data: rowsRaw, error } = await sb
      .from("firm_documents")
      .select(
        "source, id, firm_id, client_id, display_name, original_filename, ai_doc_type, ai_confidence, manual_doc_type, browse_year, browse_category, folder_id, content_hash, created_at",
      )
      .eq("firm_id", firmId)
      .is("deleted_at", null)
      .limit(MAX_DOCS_PER_FIRM + 1);
    if (error || !rowsRaw) continue;
    if (rowsRaw.length > MAX_DOCS_PER_FIRM) result.truncated = true;

    const rows: ScanRow[] = rowsRaw.slice(0, MAX_DOCS_PER_FIRM).map((r: Record<string, unknown>) => {
      const raw = r;
      return {
        source: String(raw.source),
        id: String(raw.id),
        firm_id: String(raw.firm_id),
        client_id: String(raw.client_id),
        name:
          (typeof raw.display_name === "string" && raw.display_name.trim()) ||
          String(raw.original_filename ?? ""),
        ai_doc_type: (raw.ai_doc_type as string | null) ?? null,
        ai_confidence:
          raw.ai_confidence == null ? null : Number(raw.ai_confidence),
        manual_doc_type: (raw.manual_doc_type as string | null) ?? null,
        browse_year: (raw.browse_year as number | null) ?? null,
        browse_category: (raw.browse_category as string | null) ?? null,
        folder_id: (raw.folder_id as string | null) ?? null,
        content_hash: (raw.content_hash as string | null) ?? null,
        created_at: String(raw.created_at),
      };
    });
    result.scanned += rows.length;
    const rowByKey = new Map(rows.map((r) => [`${r.source}|${r.id}`, r]));

    // ── expire stale open suggestions: the document changed or vanished ──
    const { data: openRows } = await sb
      .from("organize_suggestions")
      .select("id, source, document_id, current_state")
      .eq("firm_id", firmId)
      .eq("status", "open");
    const expiredIds: string[] = [];
    for (const s of (openRows ?? []) as Array<{
      id: string;
      source: string;
      document_id: string;
      current_state: unknown;
    }>) {
      const row = rowByKey.get(`${s.source}|${s.document_id}`);
      if (!row || !stateMatches(s.current_state, row)) expiredIds.push(s.id);
    }
    if (expiredIds.length > 0) {
      await sb
        .from("organize_suggestions")
        .update({ status: "expired" })
        .in("id", expiredIds);
      result.expired += expiredIds.length;
    }

    // ── build candidates ────────────────────────────────────────────────
    const candidates: SuggestionInsert[] = [];

    // Deterministic category misfiles — but never against a hand-pinned
    // category. The manual flags live on the tables, not the view.
    const misfileMaybe = rows.filter((r) => categoryMisfile(r) !== null);
    const manualCategory = await fetchManualCategoryFlags(sb, misfileMaybe);
    for (const r of misfileMaybe) {
      if (manualCategory.has(`${r.source}|${r.id}`)) continue;
      const fix = categoryMisfile(r);
      if (!fix) continue;
      candidates.push({
        firm_id: r.firm_id,
        client_id: r.client_id,
        source: r.source,
        document_id: r.id,
        bucket: "misfile",
        current_state: stateOf(r),
        proposed_state: { category: fix.category },
        reasoning: null,
      });
    }

    candidates.push(...duplicateSuggestions(rows));

    // ── Luna: name-based proposals ──────────────────────────────────────
    // Three pools share the per-run cap: unlabeled files (type proposals),
    // low-confidence files (second opinions), and — founder direction — any
    // UNFILED file of a client that has folders, so the folders the firm
    // created are destinations too. Batches are grouped per client, because
    // each call carries that client's folder names.
    const { data: folderRows } = await sb
      .from("document_folders")
      .select("id, client_id, name")
      .eq("firm_id", firmId)
      .is("deleted_at", null);
    const foldersByClient = new Map<
      string,
      ReturnType<typeof buildFolderIndex>
    >();
    {
      const grouped = new Map<string, Array<{ id: string; name: string }>>();
      for (const f of (folderRows ?? []) as Array<{
        id: string;
        client_id: string;
        name: string;
      }>) {
        const g = grouped.get(f.client_id) ?? [];
        g.push({ id: f.id, name: f.name });
        grouped.set(f.client_id, g);
      }
      for (const [clientId, fs] of grouped) {
        foldersByClient.set(clientId, buildFolderIndex(fs));
      }
    }

    const { unprocessed, lowConfidence } = lunaCandidates(rows);
    const inTypePools = new Set(
      [...unprocessed, ...lowConfidence].map((r) => `${r.source}|${r.id}`),
    );
    // Well-typed but unfiled, for a client with folders: folder-match only.
    const filingPool = rows.filter(
      (r) =>
        r.folder_id == null &&
        foldersByClient.has(r.client_id) &&
        !inTypePools.has(`${r.source}|${r.id}`),
    );

    const lunaPool: Array<{ row: ScanRow; bucket: OrganizeBucket }> = [
      ...unprocessed.map((row) => ({ row, bucket: "unprocessed" as const })),
      ...lowConfidence.map((row) => ({ row, bucket: "low_confidence" as const })),
      ...filingPool.map((row) => ({ row, bucket: "filing" as const })),
    ].slice(0, MAX_LUNA_FILES_PER_RUN);
    if (
      unprocessed.length + lowConfidence.length + filingPool.length >
      lunaPool.length
    ) {
      result.truncated = true;
    }

    const byId = new Map(lunaPool.map((c) => [`${c.row.source}:${c.row.id}`, c]));
    const validDocTypes = Object.keys(DOC_TYPE_LABELS);
    const byClient = new Map<string, typeof lunaPool>();
    for (const c of lunaPool) {
      const g = byClient.get(c.row.client_id) ?? [];
      g.push(c);
      byClient.set(c.row.client_id, g);
    }
    for (const [clientId, pool] of byClient) {
      const folderIndex = foldersByClient.get(clientId);
      for (let i = 0; i < pool.length; i += LUNA_BATCH) {
        const batch = pool.slice(i, i + LUNA_BATCH);
        const files: LunaFile[] = batch.map((c) => ({
          id: `${c.row.source}:${c.row.id}`,
          name: c.row.name,
          currentDocType: c.row.ai_doc_type,
          currentYear: c.row.browse_year,
        }));
        try {
          const { proposals } = await organizeWithLuna({
            files,
            validDocTypes,
            folderNames: folderIndex?.names,
          });
          result.lunaFiles += files.length;
          candidates.push(
            ...proposalsToSuggestions(proposals, byId, folderIndex?.idByName),
          );
        } catch {
          // A failed Luna batch skips those files this run; the nightly rerun
          // is the retry path. Suggestions are advisory — never worth crashing
          // the whole scan for.
        }
      }
    }

    // ── insert, skipping anything already open or dismissed ─────────────
    const { data: existing } = await sb
      .from("organize_suggestions")
      .select("source, document_id, bucket")
      .eq("firm_id", firmId)
      .in("status", ["open", "dismissed"]);
    const taken = new Set(
      ((existing ?? []) as Array<{ source: string; document_id: string; bucket: string }>).map(
        (e) => `${e.source}|${e.document_id}|${e.bucket}`,
      ),
    );
    for (const c of candidates) {
      const key = `${c.source}|${c.document_id}|${c.bucket}`;
      if (taken.has(key)) continue;
      taken.add(key);
      // Row-at-a-time so one race (nightly vs on-demand) loses one row to the
      // partial unique index instead of failing the whole batch. Volume is
      // small — this is suggestions, not documents.
      const { error: insErr } = await sb.from("organize_suggestions").insert(c);
      if (!insErr) result.created[c.bucket]++;
    }
  }

  return result;
}

async function fetchManualCategoryFlags(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  rows: ScanRow[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const byTable: Record<string, { table: string; ids: string[] }> = {
    checklist: { table: "uploaded_files", ids: [] },
    final: { table: "final_documents", ids: [] },
    imported: { table: "imported_documents", ids: [] },
  };
  for (const r of rows) byTable[r.source]?.ids.push(r.id);
  for (const [source, { table, ids }] of Object.entries(byTable)) {
    if (ids.length === 0) continue;
    const { data } = await sb
      .from(table)
      .select("id, browse_category_manual")
      .in("id", ids);
    for (const row of (data ?? []) as Array<{ id: string; browse_category_manual: boolean | null }>) {
      if (row.browse_category_manual) out.add(`${source}|${row.id}`);
    }
  }
  return out;
}

// ── session-side reads (RLS-scoped) for the review UI and Home card ─────────

export type OpenSuggestion = {
  id: string;
  clientId: string;
  source: string;
  documentId: string;
  bucket: OrganizeBucket;
  currentState: DocState;
  proposedState: Record<string, unknown>;
  reasoning: string | null;
  keepSource: string | null;
  keepDocumentId: string | null;
  createdAt: string;
};

export async function listOpenSuggestions(): Promise<{
  suggestions: OpenSuggestion[];
  available: boolean;
}> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("organize_suggestions")
    .select(
      "id, client_id, source, document_id, bucket, current_state, proposed_state, reasoning, keep_source, keep_document_id, created_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return { suggestions: [], available: false };
  return {
    available: true,
    suggestions: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      clientId: String(r.client_id),
      source: String(r.source),
      documentId: String(r.document_id),
      bucket: r.bucket as OrganizeBucket,
      currentState: (r.current_state ?? {}) as DocState,
      proposedState: (r.proposed_state ?? {}) as Record<string, unknown>,
      reasoning: (r.reasoning as string | null) ?? null,
      keepSource: (r.keep_source as string | null) ?? null,
      keepDocumentId: (r.keep_document_id as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
  };
}

/** Open-suggestion counts per bucket, for the Home card. One small read. */
export async function openSuggestionCounts(): Promise<{
  counts: Record<OrganizeBucket, number>;
  total: number;
  available: boolean;
}> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("organize_suggestions")
    .select("bucket")
    .eq("status", "open")
    .limit(1000);
  const counts: Record<OrganizeBucket, number> = {
    low_confidence: 0,
    misfile: 0,
    duplicate: 0,
    unprocessed: 0,
    filing: 0,
  };
  if (error) return { counts, total: 0, available: false };
  for (const r of (data ?? []) as Array<{ bucket: OrganizeBucket }>) {
    if (counts[r.bucket] != null) counts[r.bucket]++;
  }
  const total = (data ?? []).length;
  return { counts, total, available: true };
}
