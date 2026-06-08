// Per-file accountant review + the item-status roll-up writer.
//
// recomputeItemStatus is the SINGLE writer of request_items.status for the
// accountant-review path (the item-level approve/reject that fans out to every
// file, the per-file approve/reject, a new client upload, and undo-na). It rolls
// the files' review_status up via deriveItemStatus and preserves the client's
// explicit 'na'.
//
// It deliberately does NOT read the AI auto-reject flag: that router keeps its
// own transient status writes (auto-reject vs escalate vs queue), and recompute
// only runs on a real accountant/client action that legitimately supersedes
// that transient state — so the two never fight.
//
// `sb` may be the service-role client (portal / cron paths) or the accountant's
// RLS-scoped session client; both satisfy the row scoping.

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveItemStatus, type FileReview } from "@/lib/review/rollup";

type FileRow = FileReview & {
  rejection_reason: string | null;
  reviewed_by: string | null;
};

const nowIso = () => new Date().toISOString();

export async function recomputeItemStatus(
  sb: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { data: item } = await sb
    .from("request_items")
    .select("status")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;
  // 'na' is the client's "not applicable" choice — never overwrite it from file
  // state. undo-na clears it to 'pending' first, then calls recompute.
  if (item.status === "na") return;

  const { data: rows } = await sb
    .from("uploaded_files")
    .select(
      "review_status, uploaded_at, reviewed_at, rejection_reason, reviewed_by",
    )
    .eq("request_item_id", itemId);
  const files = (rows ?? []) as FileRow[];

  const status = deriveItemStatus(files);

  // Mirror onto the item the fields existing readers still rely on: the
  // outstanding rejection's reason (the client portal shows it) and
  // approved_by/at when the item is done.
  let rejectionReason: string | null = null;
  let approvedBy: string | null = null;
  let approvedAt: string | null = null;
  if (status === "rejected") {
    rejectionReason =
      newestReviewed(files.filter((f) => f.review_status === "rejected"))
        ?.rejection_reason ?? null;
  } else if (status === "approved") {
    const latest = newestReviewed(
      files.filter((f) => f.review_status === "approved"),
    );
    approvedBy = latest?.reviewed_by ?? null;
    approvedAt = latest?.reviewed_at ?? null;
  }

  await sb
    .from("request_items")
    .update({
      status,
      rejection_reason: rejectionReason,
      approved_by: approvedBy,
      approved_at: approvedAt,
    })
    .eq("id", itemId);
}

// Most-recently-reviewed row (by reviewed_at, falling back to upload time).
function newestReviewed(files: FileRow[]): FileRow | undefined {
  return [...files].sort((a, b) =>
    (b.reviewed_at ?? b.uploaded_at).localeCompare(
      a.reviewed_at ?? a.uploaded_at,
    ),
  )[0];
}

async function writeFileReview(
  sb: SupabaseClient,
  match: { fileId: string } | { itemId: string },
  status: "pending" | "approved" | "rejected",
  reason: string | null,
  reviewerId: string | null,
): Promise<string | null> {
  const reviewed = status !== "pending";
  const q = sb.from("uploaded_files").update({
    review_status: status,
    rejection_reason: status === "rejected" ? reason : null,
    reviewed_by: reviewed ? reviewerId : null,
    reviewed_at: reviewed ? nowIso() : null,
  });
  if ("fileId" in match) {
    const { data } = await q
      .eq("id", match.fileId)
      .select("request_item_id")
      .maybeSingle();
    return (data?.request_item_id as string | undefined) ?? null;
  }
  await q.eq("request_item_id", match.itemId);
  return match.itemId;
}

// Per-file accountant decisions (wired to the Preview in Phase 3). Each updates
// the one file, then recomputes its parent item's summary.
export async function approveFile(
  sb: SupabaseClient,
  fileId: string,
  reviewerId: string | null,
): Promise<void> {
  const itemId = await writeFileReview(sb, { fileId }, "approved", null, reviewerId);
  if (itemId) await recomputeItemStatus(sb, itemId);
}

export async function rejectFile(
  sb: SupabaseClient,
  fileId: string,
  reason: string,
  reviewerId: string | null,
): Promise<void> {
  const itemId = await writeFileReview(sb, { fileId }, "rejected", reason, reviewerId);
  if (itemId) await recomputeItemStatus(sb, itemId);
}

export async function reopenFile(
  sb: SupabaseClient,
  fileId: string,
): Promise<void> {
  const itemId = await writeFileReview(sb, { fileId }, "pending", null, null);
  if (itemId) await recomputeItemStatus(sb, itemId);
}

// Item-level decision: apply one verdict to EVERY file under an item (siblings
// move together, preserving the pre-per-file behaviour) then recompute. Backs
// the existing approveItem / rejectItem / reopenItem.
export async function setAllFilesReviewForItem(
  sb: SupabaseClient,
  itemId: string,
  status: "pending" | "approved" | "rejected",
  reason: string | null,
  reviewerId: string | null,
): Promise<void> {
  await writeFileReview(sb, { itemId }, status, reason, reviewerId);
  await recomputeItemStatus(sb, itemId);
}
