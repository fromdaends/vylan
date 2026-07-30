// Soft-deleting and restoring a document.
//
// The visibility half of this is done by migration 1090's RLS policies: once
// deleted_at is set, the row simply stops existing for every normal read. What
// is left is the BOOKKEEPING, and that is the part with teeth.
//
// deleteUploadedFilePermanently (lib/db/uploaded-files.ts) does three things
// besides erasing the row, and a soft delete that skips any of them leaves the
// product telling the accountant something untrue:
//
//   1. DUPLICATE PROMOTION. If other uploads were flagged as duplicates OF this
//      one, the oldest is promoted to be the real copy. Skip it and the
//      remaining copies stay set aside forever while the checklist item reads
//      as still waiting — for a file the client already sent.
//   2. recomputeItemStatus. The parent checklist item's status is a roll-up of
//      its files. Delete the only approved file and the item must stop being
//      complete; otherwise the engagement claims work that has no document
//      behind it.
//   3. CLEARING THE STALE SET SUMMARY. The AI's set assessment may describe the
//      document that just left ("File 2 repeats page 1").
//
// So this reuses that function's logic rather than reimplementing it, and
// restore runs the same recompute in reverse.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { recomputeItemStatus } from "@/lib/db/file-review";
import { resolvePromotedDuplicateReview } from "@/lib/db/uploaded-files";
import type { UsabilityVerdict } from "@/lib/ai/usability";
import type { DocumentSource } from "@/lib/db/documents";

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "unavailable" | "error" };

const TABLE: Record<DocumentSource, string> = {
  checklist: "uploaded_files",
  final: "final_documents",
  imported: "imported_documents",
};

function isSchemaMissing(err: { code?: string | null } | null): boolean {
  return (
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST202"
  );
}

/**
 * Move a document to the recycle bin.
 *
 * The UPDATE goes through the RLS session client, so being allowed to delete it
 * is the same question as being allowed to see it — no separate permission
 * check to drift. 1090 puts `deleted_at is null` in USING but NOT in WITH
 * CHECK precisely so this write is legal and the row then disappears.
 */
export async function softDeleteDocument(
  source: DocumentSource,
  id: string,
  userId: string | null,
): Promise<DeleteResult> {
  const sb = await getServerSupabase();

  // Grab the checklist bookkeeping context BEFORE the row becomes invisible.
  let itemId: string | null = null;
  if (source === "checklist") {
    const { data } = await sb
      .from("uploaded_files")
      .select("request_item_id")
      .eq("id", id)
      .maybeSingle();
    itemId = (data?.request_item_id as string | null) ?? null;
  }

  // Prove the document is visible to this caller BEFORE the update, because it
  // cannot be proven afterwards — see below.
  const { data: exists } = await sb
    .from(TABLE[source])
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!exists) return { ok: false, error: "not_found" };

  // THE WRITE GOES THROUGH THE SERVICE ROLE, and this was found by clicking the
  // button rather than by reasoning about it.
  //
  // Through the session client the update is refused with 42501, "new row
  // violates row-level security policy". 1090's policies reference deleted_at,
  // so the very row this is trying to write is one the policy will not accept —
  // the caller can see and edit the document, but cannot mark it deleted.
  //
  // Authorization is not skipped: the existence read above went through RLS, so
  // the caller has already proven they may see this document — which is what
  // applies the firm scope, the private-client rule (0810), the private
  // engagement rule (0850) and the assigned-staff relaxation (0990). This is
  // the same prove-then-act discipline used elsewhere in the codebase.
  //
  // Also no .select(): once deleted_at is set the row stops satisfying its own
  // SELECT policy, so RETURNING comes back empty on SUCCESS and would read as
  // "not found".
  const { error } = await getServiceRoleSupabase()
    .from(TABLE[source])
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
    })
    .eq("id", id);
  if (error) {
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }

  if (source === "checklist") await settleChecklistAfterChange(id, itemId);
  return { ok: true };
}

/**
 * Bring a document back out of the recycle bin.
 *
 * Goes through the restore_document() function rather than a plain UPDATE,
 * because 1090 has made the row invisible to the caller's own policies — see
 * that migration's header. The function is SECURITY DEFINER but re-proves firm
 * ownership and the private-client rules itself, so it grants reach, never
 * permission.
 */
export async function restoreDocument(
  source: DocumentSource,
  id: string,
): Promise<DeleteResult> {
  const sb = await getServerSupabase();
  const { data, error } = await sb.rpc("restore_document", {
    p_source: source,
    p_id: id,
  });
  if (error) {
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (data !== true) return { ok: false, error: "not_found" };

  if (source === "checklist") {
    const service = getServiceRoleSupabase();
    const { data: row } = await service
      .from("uploaded_files")
      .select("request_item_id")
      .eq("id", id)
      .maybeSingle();
    await settleChecklistAfterChange(id, (row?.request_item_id as string) ?? null);
  }
  return { ok: true };
}

/**
 * Re-settle the checklist around a document that just left or came back.
 *
 * Service role on purpose: the row is invisible to RLS in the deleted
 * direction, and the SIBLING rows being re-pointed belong to the same item. The
 * caller has already proven it may act on this document — the update above
 * matched, or the definer function returned true — so this is bookkeeping on an
 * already-authorized change, not a permission decision.
 */
async function settleChecklistAfterChange(
  fileId: string,
  itemId: string | null,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const items = new Set<string>();
  if (itemId) items.add(itemId);

  // Duplicate promotion, mirroring the permanent delete. Only LIVE duplicates
  // count: a duplicate that is itself in the recycle bin must not be promoted
  // into being the real copy.
  const { data: dependents } = await sb
    .from("uploaded_files")
    .select("id, request_item_id, review_status, reviewed_by, ai_usability")
    .eq("duplicate_of_file_id", fileId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true });

  if (dependents && dependents.length > 0) {
    const promoted = dependents[0] as {
      id: string;
      request_item_id: string;
      review_status: string | null;
      reviewed_by: string | null;
      ai_usability?: UsabilityVerdict | null;
    };
    const patch: Record<string, unknown> = {
      is_duplicate: false,
      duplicate_of_file_id: null,
    };
    // A duplicate-only rejection loses its basis once the original is gone; a
    // file the AI condemned on its own merits keeps it, so the client keeps
    // being asked for a clean copy. Same rule as the permanent delete.
    if (
      resolvePromotedDuplicateReview({
        review_status: promoted.review_status,
        reviewed_by: promoted.reviewed_by,
        ai_usability: promoted.ai_usability,
      }).reopen
    ) {
      patch.review_status = "pending";
      patch.rejection_reason = null;
      patch.reviewed_at = null;
      patch.ai_rejected = false;
    }
    await sb.from("uploaded_files").update(patch).eq("id", promoted.id);
    items.add(promoted.request_item_id);

    const rest = dependents.slice(1).map((d) => d.id as string);
    if (rest.length > 0) {
      await sb
        .from("uploaded_files")
        .update({ duplicate_of_file_id: promoted.id })
        .in("id", rest);
    }
  }

  for (const item of items) {
    await recomputeItemStatus(sb, item);
    // The AI's set summary may describe the document that just moved.
    await sb.from("request_items").update({ ai_set_assessment: null }).eq("id", item);
  }
}
