import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";
import type { DocType } from "@/lib/db/templates";
import { DOC_TYPE_LABELS, docTypeLabel } from "@/lib/doc-types";

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

// The grid's view tabs. "all" shows everything; the others filter by status.
export type PreviewView = "all" | "approved" | "flagged" | "rejected";

export type PreviewDoc = {
  fileId: string;
  itemId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: PreviewStatus;
  itemStatus: RequestItemStatus;
  // How many files were uploaded under the SAME checklist item. Vylan stores
  // approve/reject on the item, not the file, so when this is > 1 approving or
  // rejecting one card moves its siblings too — the UI surfaces this count so
  // it is never a surprise.
  siblingCount: number;
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

// Resolve the single status a document shows. Order matters:
//   1. The accountant's explicit decision on the checklist item wins
//      (approved, or rejected = they sent it back to the client).
//   2. Otherwise the system's auto-reject flag — a TRUE rejection the client
//      was notified about.
//   3. Otherwise the AI's usability verdict: usable -> approved; not usable ->
//      "flagged" (a suggestion for the accountant, NOT a client rejection).
//   4. Otherwise it simply hasn't been analysed yet (neutral "pending").
export function resolvePreviewStatus(
  file: Pick<
    UploadedFile,
    "ai_usability" | "ai_rejected" | "ai_extracted_fields"
  >,
  itemStatus: RequestItemStatus,
): PreviewStatus {
  if (itemStatus === "approved") return "approved";
  if (itemStatus === "rejected") return "rejected";
  if (file.ai_rejected) return "rejected";
  if (file.ai_usability) {
    // Not usable, OR the AI flagged a content concern — most importantly the
    // WRONG DOCUMENT TYPE (e.g. a T4 uploaded for a "General Ledger Export"
    // item), which the classifier records as looks_correct === false. A
    // readable-but-wrong document must NOT auto-"approve"; it needs the
    // accountant's eye, so it's "flagged". A clean, matching read is "approved".
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
export function buildPreviewDocs(
  uploads: UploadedFile[],
  items: RequestItem[],
): PreviewDoc[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const siblingCounts = new Map<string, number>();
  for (const u of uploads) {
    siblingCounts.set(
      u.request_item_id,
      (siblingCounts.get(u.request_item_id) ?? 0) + 1,
    );
  }
  return uploads.map((u) => {
    const item = itemById.get(u.request_item_id);
    const itemStatus: RequestItemStatus = item?.status ?? "pending";
    const fields = (u.ai_extracted_fields ?? {}) as {
      extracted_year?: unknown;
    };
    const year =
      typeof fields.extracted_year === "number" ? fields.extracted_year : null;
    return {
      fileId: u.id,
      itemId: u.request_item_id,
      fileName: u.original_filename,
      mimeType: u.mime_type,
      sizeBytes: u.size_bytes,
      uploadedAt: u.uploaded_at,
      status: resolvePreviewStatus(u, itemStatus),
      itemStatus,
      siblingCount: siblingCounts.get(u.request_item_id) ?? 1,
      classification: u.ai_classification,
      extractedYear: year,
      itemLabel: item?.label ?? "",
      itemLabelFr: item?.label_fr ?? null,
      isImage: u.mime_type.startsWith("image/"),
      isPdf: u.mime_type === "application/pdf",
      searchText: buildSearchText(u, item),
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

export type PreviewCounts = {
  all: number;
  approved: number;
  flagged: number;
  rejected: number;
  pending: number;
};

export function previewCounts(docs: PreviewDoc[]): PreviewCounts {
  let approved = 0;
  let flagged = 0;
  let rejected = 0;
  let pending = 0;
  for (const d of docs) {
    if (d.status === "approved") approved++;
    else if (d.status === "flagged") flagged++;
    else if (d.status === "rejected") rejected++;
    else pending++;
  }
  return { all: docs.length, approved, flagged, rejected, pending };
}

// Filter the docs to a view. "all" returns everything; the status tabs return
// only matching docs.
export function filterDocs(docs: PreviewDoc[], view: PreviewView): PreviewDoc[] {
  if (view === "all") return docs;
  return docs.filter((d) => d.status === view);
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

// Apply optimistic, in-session status changes (keyed by checklist item, since
// that is where approve/reject lives) on top of the server-derived docs. Lets
// an approve/reject reflect instantly in the grid + tab counts before the page
// data refreshes.
export function applyOverrides(
  docs: PreviewDoc[],
  overrides: Map<string, PreviewStatus>,
): PreviewDoc[] {
  if (overrides.size === 0) return docs;
  return docs.map((d) =>
    overrides.has(d.itemId)
      ? { ...d, status: overrides.get(d.itemId)! }
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
        docs: ds,
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
        docs: ds,
      });
    }
  }
  return groups;
}

// The localized section heading (mirrors previewHeader's fallback chain): the
// item's FR/EN label, falling back to the first file's name for orphan sections.
export function groupLabel(group: PreviewGroup, locale: string): string {
  const label = locale === "fr" && group.labelFr ? group.labelFr : group.label;
  return label || group.docs[0]?.fileName || "";
}
