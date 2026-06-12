import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";
import type { DocType } from "@/lib/db/templates";
import { DOC_TYPE_LABELS, docTypeLabel } from "@/lib/doc-types";
import { matchDocument } from "@/lib/ai/matching";

// The at-a-glance states a document can show in the Preview grid:
//   * approved — the accountant accepted it, OR the AI read it as usable AND
//     matching the request (no concern). A readable-but-wrong document is NOT
//     approved — see flagged.
//   * rejected — it was ACTUALLY sent back to the client to re-upload (the
//     accountant rejected the item, or the firm's auto-reject bounced it).
//   * flagged  — the AI spotted a possible issue (unreadable, or the wrong
//     document type / wrong year / etc.) but NOTHING was sent to the client;
//     it's waiting on the accountant. (This used to show as "rejected", which
//     wrongly implied the client had already been told.)
//   * pending  — the AI hasn't finished analysing yet. There is NO "unsure".
export type PreviewStatus = "approved" | "rejected" | "flagged" | "pending";

// The grid's view tabs. "all" shows everything; "duplicates" shows only the
// exact re-uploads; the rest filter by status. A duplicate is its OWN bucket —
// it's excluded from the approved/flagged/rejected views + counts (see
// previewCounts + filterDocs) so the numbers partition cleanly and a duplicate
// reads as a duplicate, not as "just another rejected file".
export type PreviewView =
  | "all"
  | "approved"
  | "flagged"
  | "rejected"
  | "duplicates";

export type PreviewDoc = {
  fileId: string;
  itemId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: PreviewStatus;
  itemStatus: RequestItemStatus;
  // How many files were uploaded under the SAME checklist item. Approve/reject
  // is now per FILE, so this is purely informational ("3 files on this line")
  // and the count badge no longer implies siblings move together.
  siblingCount: number;
  // Stable 1-based sequence number within this document's checklist item, with
  // the OLDEST upload as #1. Computed once from the full upload set so a
  // document keeps the same number regardless of the active search / tab / item
  // filter — the accountant can always say "Trial Balance #2" and mean one file.
  seq: number;
  // What the AI read this document as (a DocType code, "unknown", or null when
  // not analysed) + the year it pulled, used for the couple-word header.
  classification: string | null;
  extractedYear: number | null;
  // The parent checklist item's labels, used as the header fallback when the
  // AI hasn't classified the file yet.
  itemLabel: string;
  itemLabelFr: string | null;
  isImage: boolean;
  isPdf: boolean;
  // Pre-normalised haystack for keyword search: doc type (code + both EN/FR
  // names), year, issuer, taxpayer name, form id, amounts, filename, and the
  // checklist label — lower-cased and accent-stripped so search is language- and
  // accent-insensitive.
  searchText: string;
  // Duplicate detection (migration 0270): true when this upload is an exact
  // byte-for-byte re-send of an earlier file in the same engagement. The grid
  // lifts these OUT of their checklist-item section into a single "Duplicates"
  // section (groupDocsForGrid) so an item's real documents read clean.
  // duplicateOfFileId points at the ORIGINAL it copies, used to label the
  // duplicate card "Copy of [item] #N".
  isDuplicate: boolean;
  duplicateOfFileId: string | null;
};

// Strip accents + lower-case so "Rémunération" matches "remuneration" and
// "EMPLOI" matches "emploi" — the same accent/case-insensitive approach used by
// the app-wide command search.
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Resolve the single status a document card shows. Order matters:
//   1. The accountant's explicit per-file decision wins (they approved THIS
//      file, or rejected it = sent this one back to the client).
//   2. Otherwise the system's auto-reject flag — a TRUE rejection the client
//      was notified about.
//   3. Otherwise a confident mismatch with what the item asked for (wrong doc
//      type / tax year / a stranger's name) => "flagged". A perfectly legible
//      scan of the WRONG document must never pass as a green "looks good".
//   4. Otherwise the AI's usability verdict, shown as a SUGGESTION until the
//      accountant reviews: usable -> "approved" (green hint); not usable ->
//      "flagged".
//   5. Otherwise it simply hasn't been analysed yet (neutral "pending").
export function resolvePreviewStatus(
  file: Pick<
    UploadedFile,
    "review_status" | "ai_usability" | "ai_rejected" | "ai_extracted_fields"
  >,
  // True when the AI's read confidently disagrees with the request (wrong
  // type / year / client). Computed by buildPreviewDocs via `matchDocument` —
  // the SAME comparator the detail view's "Doesn't match the request" panel
  // uses — so the grid badge and that panel can never disagree.
  hasRequestMismatch = false,
): PreviewStatus {
  // The accountant's own decision on THIS file is final.
  if (file.review_status === "approved") return "approved";
  if (file.review_status === "rejected") return "rejected";
  // Not yet reviewed — surface the system / AI read so the accountant can
  // triage: a confident mismatch or an unusable scan flags; a clean read shows
  // a green "looks good" SUGGESTION (it is not yet an accountant approval).
  if (file.ai_rejected) return "rejected";
  if (hasRequestMismatch) return "flagged";
  if (file.ai_usability) {
    if (!file.ai_usability.usable || aiFlaggedConcern(file)) return "flagged";
    return "approved";
  }
  return "pending";
}

// Did the AI note a concern beyond legibility — typically a mismatch with what
// the checklist item asked for? The classifier sets looks_correct === false
// (with a reason in issue_if_any) for a wrong type, wrong year, or multiple
// slips in one file.
function aiFlaggedConcern(
  file: Pick<UploadedFile, "ai_extracted_fields">,
): boolean {
  const f = file.ai_extracted_fields as { looks_correct?: unknown } | null;
  return f?.looks_correct === false;
}

// Does the AI's read confidently disagree with what the checklist item asked
// for — wrong document type, wrong tax year, or a completely different party
// name? Reuses the SAME `matchDocument` comparator that powers the detail
// view's "Doesn't match the request" panel, so the grid status and that panel
// can never disagree. matchDocument applies its own confidence floor, so this
// stays quiet unless the AI was reasonably sure; it needs a finished
// classification (a type code + a confidence) to say anything at all.
function mismatchesRequest(
  file: Pick<
    UploadedFile,
    "ai_classification" | "ai_confidence" | "ai_extracted_fields"
  >,
  expectedDocType: DocType,
  expectedYear: number | null,
  clientName: string | null,
): boolean {
  const classification = file.ai_classification;
  const conf = file.ai_confidence;
  if (!classification || conf == null) return false;
  const f = (file.ai_extracted_fields ?? {}) as {
    extracted_year?: unknown;
    party_name?: unknown;
    fields_confidence?: unknown;
    belongs_to_client?: unknown;
    belongs_confidence?: unknown;
  };
  const flags = matchDocument({
    expectedDocType,
    expectedYear,
    clientName,
    classification: {
      document_type: classification as DocType | "unknown",
      confidence: conf,
      extracted_year:
        typeof f.extracted_year === "number" ? f.extracted_year : null,
      party_name: typeof f.party_name === "string" ? f.party_name : null,
      fields_confidence:
        typeof f.fields_confidence === "number" ? f.fields_confidence : 0,
      belongs_to_client:
        typeof f.belongs_to_client === "boolean" ? f.belongs_to_client : null,
      belongs_confidence:
        typeof f.belongs_confidence === "number" ? f.belongs_confidence : 0,
    },
  });
  return flags.length > 0;
}

function buildSearchText(
  u: UploadedFile,
  item: RequestItem | undefined,
): string {
  const f = (u.ai_extracted_fields ?? {}) as Record<string, unknown>;
  const parts: (string | null | undefined)[] = [
    u.original_filename,
    u.ai_classification,
  ];
  const code = u.ai_classification;
  if (code && code in DOC_TYPE_LABELS) {
    parts.push(
      DOC_TYPE_LABELS[code as DocType].en,
      DOC_TYPE_LABELS[code as DocType].fr,
    );
  }
  if (typeof f.extracted_year === "number") parts.push(String(f.extracted_year));
  if (typeof f.issuer_name === "string") parts.push(f.issuer_name);
  if (typeof f.party_name === "string") parts.push(f.party_name);
  if (typeof f.form_identifier === "string") parts.push(f.form_identifier);
  if (typeof f.account_or_period === "string") parts.push(f.account_or_period);
  if (Array.isArray(f.amounts)) {
    for (const a of f.amounts) {
      if (a && typeof a === "object") {
        const am = a as { label?: unknown; value?: unknown };
        if (typeof am.label === "string") parts.push(am.label);
        if (typeof am.value === "number") parts.push(String(am.value));
      }
    }
  }
  parts.push(item?.label, item?.label_fr);
  return normalizeText(parts.filter(Boolean).join(" "));
}

// Build the Preview view-model from the raw uploads + checklist items the
// engagement page already loaded. Pure + serialisable so it can run inside the
// client overlay (via useMemo) and be unit-tested directly.
//
// `opts` carries the engagement-level expectations the per-document match check
// needs: the tax year (read off the engagement title) and the client's name.
// Both are optional so callers / tests that don't care about matching keep
// working; without them only a wrong-doc-type mismatch can ever surface.
export function buildPreviewDocs(
  uploads: UploadedFile[],
  items: RequestItem[],
  opts: { expectedYear?: number | null; clientName?: string | null } = {},
): PreviewDoc[] {
  const expectedYear = opts.expectedYear ?? null;
  const clientName = opts.clientName ?? null;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const siblingCounts = new Map<string, number>();
  for (const u of uploads) {
    siblingCounts.set(
      u.request_item_id,
      (siblingCounts.get(u.request_item_id) ?? 0) + 1,
    );
  }
  // Stable per-item sequence numbers (oldest upload = #1), computed from the
  // FULL set so search / tab / item filters never renumber a document.
  // Tie-break on file id when two uploads share a timestamp, for determinism.
  const seqByFile = new Map<string, number>();
  {
    const byItem = new Map<string, UploadedFile[]>();
    for (const u of uploads) {
      const arr = byItem.get(u.request_item_id);
      if (arr) arr.push(u);
      else byItem.set(u.request_item_id, [u]);
    }
    for (const arr of byItem.values()) {
      arr.sort((a, b) => {
        const t = a.uploaded_at.localeCompare(b.uploaded_at);
        return t !== 0 ? t : a.id.localeCompare(b.id);
      });
      arr.forEach((u, i) => seqByFile.set(u.id, i + 1));
    }
  }
  return uploads.map((u) => {
    const item = itemById.get(u.request_item_id);
    const itemStatus: RequestItemStatus = item?.status ?? "pending";
    const fields = (u.ai_extracted_fields ?? {}) as {
      extracted_year?: unknown;
    };
    const year =
      typeof fields.extracted_year === "number" ? fields.extracted_year : null;
    // What the checklist item asked for; "other" (the freeform-item default)
    // means no specific type was requested — matchDocument treats it as such.
    const expectedDocType: DocType = item?.doc_type ?? "other";
    const mismatch = mismatchesRequest(
      u,
      expectedDocType,
      expectedYear,
      clientName,
    );
    return {
      fileId: u.id,
      itemId: u.request_item_id,
      fileName: u.original_filename,
      mimeType: u.mime_type,
      sizeBytes: u.size_bytes,
      uploadedAt: u.uploaded_at,
      status: resolvePreviewStatus(u, mismatch),
      itemStatus,
      siblingCount: siblingCounts.get(u.request_item_id) ?? 1,
      seq: seqByFile.get(u.id) ?? 1,
      classification: u.ai_classification,
      extractedYear: year,
      itemLabel: item?.label ?? "",
      itemLabelFr: item?.label_fr ?? null,
      isImage: u.mime_type.startsWith("image/"),
      isPdf: u.mime_type === "application/pdf",
      searchText: buildSearchText(u, item),
      isDuplicate: u.is_duplicate,
      duplicateOfFileId: u.duplicate_of_file_id,
    };
  });
}

// The couple-word grid header: the AI's short doc-type name (the bit before the
// " — " in the official form title, e.g. "T4", "RL-1", "Bank statements") plus
// the year when known. Falls back to the checklist item label, then the
// filename, when the AI hasn't classified the document yet.
export function previewHeader(doc: PreviewDoc, locale: string): string {
  const code = doc.classification;
  if (code && code !== "unknown" && code in DOC_TYPE_LABELS) {
    const short = docTypeLabel(code as DocType, locale).split(" — ")[0].trim();
    return doc.extractedYear ? `${short} · ${doc.extractedYear}` : short;
  }
  const label =
    locale === "fr" && doc.itemLabelFr ? doc.itemLabelFr : doc.itemLabel;
  return label || doc.fileName;
}

// The accountant's at-a-glance handle for a document card: the checklist item
// name plus the document's stable sequence number within that item, e.g.
// "Trial Balance #2". Falls back to the doc-type/year header, then the
// filename, for orphan files whose checklist item was deleted — so a number is
// always paired with SOMETHING recognisable.
export function previewCardTitle(doc: PreviewDoc, locale: string): string {
  const itemName =
    locale === "fr" && doc.itemLabelFr ? doc.itemLabelFr : doc.itemLabel;
  const base = itemName || previewHeader(doc, locale);
  return base ? `${base} #${doc.seq}` : `#${doc.seq}`;
}

export type PreviewCounts = {
  all: number;
  approved: number;
  flagged: number;
  rejected: number;
  pending: number;
  duplicates: number;
};

// Count docs per bucket. Duplicates are SET ASIDE from the main review flow:
// `all` is the count of REAL (non-duplicate) documents and equals
// approved + flagged + rejected + pending, while `duplicates` is a separate
// side-bucket with its own tab (so all + duplicates === docs.length). A
// duplicate is never counted under approved/flagged/rejected/pending even if its
// underlying review_status is "rejected" — it only ever counts as a duplicate.
export function previewCounts(docs: PreviewDoc[]): PreviewCounts {
  let approved = 0;
  let flagged = 0;
  let rejected = 0;
  let pending = 0;
  let duplicates = 0;
  for (const d of docs) {
    if (d.isDuplicate) {
      duplicates++;
      continue;
    }
    if (d.status === "approved") approved++;
    else if (d.status === "flagged") flagged++;
    else if (d.status === "rejected") rejected++;
    else pending++;
  }
  return {
    all: approved + flagged + rejected + pending,
    approved,
    flagged,
    rejected,
    pending,
    duplicates,
  };
}

// Filter the docs to a view. "all" returns the REAL documents — duplicates are
// excluded, they live ONLY under the Duplicates tab; "duplicates" returns only
// the exact re-uploads; the status tabs return only NON-duplicate docs of that
// status. Mirrors previewCounts: duplicates are set aside, never shown alongside
// the real documents in any view but their own.
export function filterDocs(docs: PreviewDoc[], view: PreviewView): PreviewDoc[] {
  if (view === "all") return docs.filter((d) => !d.isDuplicate);
  if (view === "duplicates") return docs.filter((d) => d.isDuplicate);
  return docs.filter((d) => !d.isDuplicate && d.status === view);
}

// Filter to a single checklist item, or "all" to keep everything. Combines with
// the status tabs + keyword search — apply it alongside them on the searched set
// so the tab counts reflect the chosen item.
export function filterByItem(docs: PreviewDoc[], itemId: string): PreviewDoc[] {
  if (itemId === "all") return docs;
  return docs.filter((d) => d.itemId === itemId);
}

// Keyword search: every whitespace-separated token in the query must appear in
// the document's haystack (AND, so "bank 2024" narrows). Empty query matches
// everything. Combines with the status tabs (apply search first, then filter).
export function searchDocs(docs: PreviewDoc[], query: string): PreviewDoc[] {
  const q = normalizeText(query.trim());
  if (!q) return docs;
  const tokens = q.split(/\s+/).filter(Boolean);
  return docs.filter((d) => tokens.every((tok) => d.searchText.includes(tok)));
}

// Apply optimistic, in-session status changes (keyed by FILE id, since
// approve/reject is now per file) on top of the server-derived docs. Lets an
// approve/reject reflect instantly in the grid + tab counts before the page
// data refreshes.
export function applyOverrides(
  docs: PreviewDoc[],
  overrides: Map<string, PreviewStatus>,
): PreviewDoc[] {
  if (overrides.size === 0) return docs;
  return docs.map((d) =>
    overrides.has(d.fileId)
      ? { ...d, status: overrides.get(d.fileId)! }
      : d,
  );
}

// A checklist-item section in the Preview grid: every document uploaded under
// one request item, grouped together so the accountant reviews an item's files
// side by side instead of scanning a mixed wall.
export type PreviewGroup = {
  itemId: string;
  label: string;
  labelFr: string | null;
  docType: string | null;
  docs: PreviewDoc[];
};

// Group docs by their checklist item, in checklist order (the `items` array is
// already ordered by order_index). Items with no matching docs are skipped, so
// this composes with the tab + search filters: pass the already-filtered docs
// and only the sections that still have something show up. A file whose item was
// deleted (orphan) keeps its own trailing section so nothing silently vanishes.
export function groupDocsByItem(
  docs: PreviewDoc[],
  items: RequestItem[],
): PreviewGroup[] {
  const byItem = new Map<string, PreviewDoc[]>();
  for (const d of docs) {
    const arr = byItem.get(d.itemId);
    if (arr) arr.push(d);
    else byItem.set(d.itemId, [d]);
  }
  const groups: PreviewGroup[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const ds = byItem.get(it.id);
    if (ds && ds.length > 0) {
      groups.push({
        itemId: it.id,
        label: it.label,
        labelFr: it.label_fr,
        docType: it.doc_type,
        docs: [...ds].sort((a, b) => a.seq - b.seq),
      });
      seen.add(it.id);
    }
  }
  for (const [itemId, ds] of byItem) {
    if (!seen.has(itemId)) {
      groups.push({
        itemId,
        label: ds[0]?.itemLabel ?? "",
        labelFr: ds[0]?.itemLabelFr ?? null,
        docType: ds[0]?.classification ?? null,
        docs: [...ds].sort((a, b) => a.seq - b.seq),
      });
    }
  }
  return groups;
}

// Sentinel id for the synthetic "Duplicates" section — not a real request item,
// so it can never collide with a checklist item's UUID. The overlay swaps in a
// localized heading for it ("Duplicates" / "Doublons").
export const DUPLICATES_SECTION_ID = "__duplicates__";

// Group docs for the Preview GRID: the usual one-section-per-checklist-item
// layout, then a single trailing "Duplicates" section gathering every
// exact-content re-upload (is_duplicate). A duplicate is REMOVED from its item
// section and shown ONLY here — one file, one place — so an item's real
// documents never read as cluttered by repeats. Pass already-filtered docs
// (tabs / search / item filter); empty sections don't render, and the Duplicates
// section is omitted entirely when there are no duplicates.
export function groupDocsForGrid(
  docs: PreviewDoc[],
  items: RequestItem[],
): PreviewGroup[] {
  const duplicates = docs.filter((d) => d.isDuplicate);
  const originals = docs.filter((d) => !d.isDuplicate);
  const groups = groupDocsByItem(originals, items);
  if (duplicates.length > 0) {
    groups.push({
      itemId: DUPLICATES_SECTION_ID,
      label: "",
      labelFr: null,
      docType: null,
      // Oldest upload first (tie-break on file id) so the order is stable across
      // renders, mirroring the per-item seq ordering elsewhere in the grid.
      docs: [...duplicates].sort((a, b) => {
        const t = a.uploadedAt.localeCompare(b.uploadedAt);
        return t !== 0 ? t : a.fileId.localeCompare(b.fileId);
      }),
    });
  }
  return groups;
}

// The localized section heading (mirrors previewHeader's fallback chain): the
// item's FR/EN label, falling back to the first file's name for orphan sections.
export function groupLabel(group: PreviewGroup, locale: string): string {
  const label = locale === "fr" && group.labelFr ? group.labelFr : group.label;
  return label || group.docs[0]?.fileName || "";
}
