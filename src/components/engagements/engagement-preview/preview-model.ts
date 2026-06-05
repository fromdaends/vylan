import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";

// The at-a-glance states a document can show in the Preview grid. Deliberately
// only two "decided" states (approved / rejected) plus a neutral "pending" for
// documents the AI hasn't finished analysing yet — there is NO "unsure".
export type PreviewStatus = "approved" | "rejected" | "pending";

// The grid's view tabs. "all" shows everything; the other two filter by status.
export type PreviewView = "all" | "approved" | "rejected";

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
};

// Resolve the single status a document shows. Order matters:
//   1. The accountant's explicit decision on the checklist item wins.
//   2. Otherwise the system's auto-reject flag.
//   3. Otherwise the AI's usability verdict (usable -> approved, else rejected).
//   4. Otherwise it simply hasn't been analysed yet (neutral "pending").
export function resolvePreviewStatus(
  file: Pick<UploadedFile, "ai_usability" | "ai_rejected">,
  itemStatus: RequestItemStatus,
): PreviewStatus {
  if (itemStatus === "approved") return "approved";
  if (itemStatus === "rejected") return "rejected";
  if (file.ai_rejected) return "rejected";
  if (file.ai_usability) {
    return file.ai_usability.usable ? "approved" : "rejected";
  }
  return "pending";
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
    const itemStatus: RequestItemStatus =
      itemById.get(u.request_item_id)?.status ?? "pending";
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
    };
  });
}

export type PreviewCounts = {
  all: number;
  approved: number;
  rejected: number;
  pending: number;
};

export function previewCounts(docs: PreviewDoc[]): PreviewCounts {
  let approved = 0;
  let rejected = 0;
  let pending = 0;
  for (const d of docs) {
    if (d.status === "approved") approved++;
    else if (d.status === "rejected") rejected++;
    else pending++;
  }
  return { all: docs.length, approved, rejected, pending };
}

// Filter the docs to a view. "all" returns everything; the status tabs return
// only matching docs. (Search filtering is layered on top in a later phase.)
export function filterDocs(docs: PreviewDoc[], view: PreviewView): PreviewDoc[] {
  if (view === "all") return docs;
  return docs.filter((d) => d.status === view);
}
