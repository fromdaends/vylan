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

// ── Near-duplicate detection (Dext-style, post-extraction) ───────────────────
//
// The hash check above only catches a BYTE-IDENTICAL re-upload. The same
// invoice photographed and also emailed, or re-scanned, produces different
// bytes and sails straight through — which is the commonest real-world
// duplicate, not the rarest.
//
// So a second pass runs AFTER the AI has read the document, comparing the
// fields Dext compares. The rules are theirs, and the split is the clever part:
//
//   invoices / credit notes -> supplier + total + DOCUMENT NUMBER, ignoring date
//   receipts (no number)    -> supplier + date + total
//
// Ignoring the date on a numbered document is deliberate. An invoice carries
// several plausible dates (issue, due, service period) and two reads of the
// same paper can legitimately disagree, while the number is the document's own
// unique identity. Hubdoc requires date AND supplier AND total AND matching
// numbers, and consequently misses more.
//
// THIS NEVER AUTO-REJECTS. The hash check is deterministic, so auto-rejecting
// on it is safe; this one is probabilistic (a client on a monthly retainer
// genuinely bills the same supplier the same amount every month) and a wrong
// auto-reject silently loses a real document. It only ever flags for review.

export type FieldDuplicateDoc = {
  id: string;
  // The other party as printed (vendor on a bill, customer on a sales invoice).
  supplier: string | null;
  // Grand total INCLUDING tax, in dollars. Compared in integer cents.
  total: number | null;
  // The document's own number, when it printed one.
  documentNumber: string | null;
  documentDate: string | null; // ISO YYYY-MM-DD
  uploadedAt: string;
};

// Normalize a party name for comparison: lowercase, strip punctuation and
// company suffixes, collapse whitespace. Two reads of the same paper often
// differ by a trailing "Inc." or a stray comma.
function partyKey(name: string | null): string | null {
  if (!name) return null;
  const k = name
    .normalize("NFD")
    // Strip combining accents: two reads of the same Quebec supplier routinely
    // differ by "Boréal" vs "Boreal", and treating those as different names
    // would miss the commonest duplicate in a bilingual client base.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return k || null;
}

// A document number is only an identity if it has some substance — a bare "1"
// or "-" is noise that would collide across unrelated documents.
function numberKey(n: string | null): string | null {
  if (!n) return null;
  const k = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k.length >= 3 ? k : null;
}

// Money in integer cents, so 114.98 never fails to equal 114.98.
function cents(total: number | null): number | null {
  return total == null ? null : Math.round(total * 100);
}

// Do these two documents look like the same piece of paper? PURE.
export function isFieldDuplicate(
  a: FieldDuplicateDoc,
  b: FieldDuplicateDoc,
): boolean {
  const supplier = partyKey(a.supplier);
  const amount = cents(a.total);
  // Supplier and amount anchor every comparison. Without either we have no
  // basis at all — Dext is explicit that missing key fields mean no match, and
  // guessing here would flag unrelated documents at each other.
  if (!supplier || amount == null) return false;
  if (partyKey(b.supplier) !== supplier) return false;
  if (cents(b.total) !== amount) return false;

  const numA = numberKey(a.documentNumber);
  const numB = numberKey(b.documentNumber);
  // BOTH numbered -> the number decides, and the date is deliberately ignored.
  if (numA && numB) return numA === numB;
  // One numbered and the other not is NOT a match on supplier+total alone:
  // that is exactly the monthly-retainer false positive.
  if (numA || numB) return false;
  // Neither numbered (a receipt) -> fall back to the date.
  return (
    a.documentDate != null &&
    a.documentDate === b.documentDate
  );
}

// The EARLIEST earlier upload this document duplicates, or null. Candidates are
// other files in the same engagement; the caller excludes the document itself.
export function findFieldDuplicateOriginalId(
  doc: FieldDuplicateDoc,
  candidates: FieldDuplicateDoc[],
): string | null {
  const matches = candidates
    .filter((c) => c.id !== doc.id && isFieldDuplicate(doc, c))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return matches[0]?.id ?? null;
}

// Read this engagement's other documents, compare fields, and flag a match.
//
// Best-effort by construction: any error (including the 0990 column not
// existing yet) leaves the document unflagged and is swallowed. Detection must
// never be able to fail a classification.
export async function flagNearDuplicate(
  supabase: SupabaseClient,
  fileId: string,
  engagementId: string,
  transaction: {
    vendor_name?: string | null;
    customer_name?: string | null;
    document_date?: string | null;
    document_number?: string | null;
    total?: number | null;
  } | null,
): Promise<void> {
  // No transaction pass ran (not a receipt/invoice, or no bookkeeping
  // connection) -> nothing to compare on.
  if (!transaction) return;
  const self: FieldDuplicateDoc = {
    id: fileId,
    supplier: transaction.vendor_name ?? transaction.customer_name ?? null,
    total: transaction.total ?? null,
    documentNumber: transaction.document_number ?? null,
    documentDate: transaction.document_date ?? null,
    uploadedAt: "",
  };
  if (!self.supplier || self.total == null) return; // can't compare on nothing

  try {
    const { data, error } = await supabase
      .from("uploaded_files")
      .select("id, uploaded_at, ai_extracted_fields")
      .eq("engagement_id", engagementId)
      .neq("id", fileId);
    if (error || !data) return;

    const candidates: FieldDuplicateDoc[] = data.flatMap((r) => {
      const row = r as {
        id: string;
        uploaded_at: string;
        ai_extracted_fields: { transaction?: Record<string, unknown> } | null;
      };
      const t = row.ai_extracted_fields?.transaction;
      if (!t) return [];
      return [
        {
          id: row.id,
          supplier:
            (t.vendor_name as string | null) ??
            (t.customer_name as string | null) ??
            null,
          total: (t.total as number | null) ?? null,
          documentNumber: (t.document_number as string | null) ?? null,
          documentDate: (t.document_date as string | null) ?? null,
          uploadedAt: row.uploaded_at,
        },
      ];
    });

    const originalId = findFieldDuplicateOriginalId(self, candidates);
    if (!originalId) return;
    await supabase
      .from("uploaded_files")
      .update({ possible_duplicate_of_file_id: originalId })
      .eq("id", fileId);
  } catch {
    // Swallowed on purpose — see the note above.
  }
}
