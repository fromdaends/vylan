// Duplicate-document detection + routing.
//
// A "duplicate" is an EXACT-content re-upload: a new file whose SHA-256
// fingerprint (content_hash) matches an earlier upload in the same engagement.
// This is deterministic — byte-identical files are unambiguously duplicates, so
// there are no false positives (unlike a fuzzy "looks like the same form" check,
// which we deliberately do NOT do here).
//
// Two pure pieces (easy to unit-test) + one side-effecting apply:
//   * findDuplicateOriginalId(...) — does this new upload duplicate an earlier
//     one? Returns the earlier file's id, or null.
//   * decideDuplicate(...) — given the firm's separate `auto_reject_duplicates`
//     flag, auto-reject or just flag?
//   * applyDuplicateDecision(...) — the DB writes + audit row for the choice.
//
// A detected duplicate is set ASIDE: it is marked is_duplicate=true and
// deriveItemStatus (rollup.ts) ignores duplicates, so a duplicate never drags
// the checklist item into "needs attention" — the ORIGINAL upload is what
// counts. The client is never nagged to re-send (their original is fine).

import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeItemStatus } from "@/lib/db/file-review";

// An existing file in the engagement to compare a new upload against.
export type DuplicateCandidate = {
  id: string;
  content_hash: string | null;
  uploaded_at: string;
};

// The EARLIER upload a new file duplicates: the oldest existing file in the same
// engagement whose fingerprint matches the new one. Returns its id, or null when
// the new upload is unique. A null/empty new hash never matches, and candidates
// with no fingerprint (legacy rows, pre-feature uploads) are ignored — so we
// never flag against a file we can't actually compare. PURE.
export function findDuplicateOriginalId(
  newHash: string | null,
  candidates: DuplicateCandidate[],
): string | null {
  if (!newHash) return null;
  const matches = candidates
    .filter((c) => c.content_hash != null && c.content_hash === newHash)
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  return matches[0]?.id ?? null;
}

export type DuplicateDecision = "auto_reject" | "flag";

// The firm's SEPARATE duplicate setting (NOT auto_reject_unusable_docs): ON =
// auto-reject the duplicate, OFF = only flag it for the accountant's review.
export function decideDuplicate(autoRejectOn: boolean): DuplicateDecision {
  return autoRejectOn ? "auto_reject" : "flag";
}

// Client-facing reason on a rejected duplicate, in both languages so the portal
// follows the language toggle. No jargon, no "AI".
export const DUPLICATE_REASON: Record<"fr" | "en", string> = {
  fr: "Ce document a déjà été téléversé.",
  en: "This document was already uploaded.",
};

export type ApplyDuplicateContext = {
  // Service-role client (the portal upload route already uses it).
  supabase: SupabaseClient;
  decision: DuplicateDecision;
  fileId: string;
  originalFileId: string;
  requestItemId: string;
  engagementId: string;
  firmId: string;
  clientLocale: "fr" | "en";
};

// Persist a detected duplicate. BOTH paths mark is_duplicate + duplicate_of so
// the file is set aside (deriveItemStatus ignores duplicates) and the UI can
// badge it; auto_reject additionally marks the file rejected with the duplicate
// reason so the accountant sees it was auto-handled. recompute re-derives the
// item from its NON-duplicate files (so a duplicate never makes the item read
// "needs attention"). An audit row records the action. No client retry job is
// queued — a duplicate is not something the client needs to re-send.
export async function applyDuplicateDecision(
  ctx: ApplyDuplicateContext,
): Promise<void> {
  const {
    supabase,
    decision,
    fileId,
    originalFileId,
    requestItemId,
    engagementId,
    firmId,
  } = ctx;

  if (decision === "auto_reject") {
    await supabase
      .from("uploaded_files")
      .update({
        is_duplicate: true,
        duplicate_of_file_id: originalFileId,
        review_status: "rejected",
        rejection_reason: DUPLICATE_REASON[ctx.clientLocale],
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", fileId);
  } else {
    await supabase
      .from("uploaded_files")
      .update({
        is_duplicate: true,
        duplicate_of_file_id: originalFileId,
      })
      .eq("id", fileId);
  }

  await recomputeItemStatus(supabase, requestItemId);

  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action:
      decision === "auto_reject"
        ? "duplicate_auto_rejected"
        : "duplicate_flagged",
    metadata: {
      uploaded_file_id: fileId,
      request_item_id: requestItemId,
      duplicate_of_file_id: originalFileId,
    },
  });
}
