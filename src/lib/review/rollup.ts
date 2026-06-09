// Roll a checklist item's per-file accountant decisions up to the single status
// the item shows everywhere — the accountant dashboards, the "Ready to review"
// tab, the client portal, and the progress ring. PURE + side-effect free so it
// is the one source of truth for the rule and can be unit-tested directly;
// recomputeItemStatus persists whatever this returns.
//
// Each file carries its own review_status. The rule (founder's spec, section 6):
//   * REJECTED (needs attention): there is an OUTSTANDING rejection — a rejected
//     file the client has NOT yet answered with a newer upload. A rejection is
//     an explicit "client, do something", so it wins even over an approved
//     sibling. Once the client re-uploads, that newer file answers the rejection
//     and the item moves to "in review".
//   * APPROVED (done): at least one approved file AND no outstanding rejection.
//   * SUBMITTED (in review): files exist, none approved, no outstanding rejection
//     (all pending, or every rejection already answered by a newer upload).
//   * PENDING (not started): no files at all.
//
// 'na' (not applicable) is a client choice tracked separately and is NEVER
// produced here — the caller preserves it.

import type { RequestItemStatus } from "@/lib/db/request-items";

export type FileReview = {
  review_status: "pending" | "approved" | "rejected";
  // ISO timestamps. uploaded_at is when the client sent the file; reviewed_at is
  // when the accountant approved/rejected it (null until reviewed).
  uploaded_at: string;
  reviewed_at: string | null;
  // A detected duplicate (an exact-content re-upload) is set ASIDE: it never
  // affects the item's status — the ORIGINAL upload it duplicates is what
  // counts. Optional; absent/false on every non-duplicate file.
  is_duplicate?: boolean | null;
};

export type RolledUpStatus = Exclude<RequestItemStatus, "na">;

function ms(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// Is this rejected file still outstanding — i.e. has the client NOT uploaded any
// replacement after it was rejected? A file uploaded strictly after the
// rejection's reviewed_at counts as the client's answer. (reviewed_at falls back
// to the file's own upload time for backfilled rejections that predate this
// per-file model.)
function isOutstandingRejection(file: FileReview, all: FileReview[]): boolean {
  if (file.review_status !== "rejected") return false;
  const rejectedAt = ms(file.reviewed_at ?? file.uploaded_at);
  return !all.some((other) => ms(other.uploaded_at) > rejectedAt);
}

export function deriveItemStatus(files: FileReview[]): RolledUpStatus {
  // Duplicates are set aside before any roll-up: a byte-identical re-upload
  // never drags the item into "needs attention" and never counts as progress —
  // the original upload it duplicates is what matters. (A rejection is therefore
  // only "answered" by a newer NON-duplicate upload.)
  const real = files.filter((f) => !f.is_duplicate);
  if (real.length === 0) return "pending";
  if (real.some((f) => isOutstandingRejection(f, real))) return "rejected";
  if (real.some((f) => f.review_status === "approved")) return "approved";
  // Files exist with no outstanding rejection and nothing approved → still
  // waiting on the accountant (pending uploads, or an answered re-upload).
  return "submitted";
}
