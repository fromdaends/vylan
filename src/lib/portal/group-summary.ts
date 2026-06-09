import type { RequestItem } from "@/lib/db/request-items";

// Honest one-line summaries for the two portal hub cards. Kept pure + tested so
// the counts a client sees on the landing match the per-item states exactly.

// "To sign" card. Input is the signature items only.
export type SignSummary =
  | { kind: "to_sign"; count: number } // client still needs to sign some
  | { kind: "in_review"; count: number } // all sent; waiting on the accountant
  | { kind: "all_signed" } // every signature confirmed
  | { kind: "none" }; // no signature items (card not shown)

export function summarizeSignatures(items: RequestItem[]): SignSummary {
  if (items.length === 0) return { kind: "none" };
  // The client's outstanding action: pending (not yet signed) or rejected
  // (sent back). 'submitted' is with the accountant; 'approved'/'na' are done.
  const toSign = items.filter(
    (i) => i.status === "pending" || i.status === "rejected",
  ).length;
  if (toSign > 0) return { kind: "to_sign", count: toSign };
  const inReview = items.filter((i) => i.status === "submitted").length;
  if (inReview > 0) return { kind: "in_review", count: inReview };
  return { kind: "all_signed" };
}

// "Your documents" card. Input is the document-collection items only.
export type DocSummary =
  | { kind: "needs_attention"; count: number } // some rejected / flagged
  | { kind: "outstanding"; done: number; total: number } // some still to send / in review
  | { kind: "all_set" } // every document approved / not applicable
  | { kind: "none" }; // no document items (card not shown)

export function summarizeDocuments(items: RequestItem[]): DocSummary {
  if (items.length === 0) return { kind: "none" };
  // "Needs attention" = the accountant rejected it OR a reason is recorded (an
  // AI auto-reject leaves the item pending but with a reason). Mirrors the
  // document card's needs-attention state.
  const needsAttention = items.filter(
    (i) =>
      i.status === "rejected" ||
      (typeof i.rejection_reason === "string" &&
        i.rejection_reason.trim() !== ""),
  ).length;
  if (needsAttention > 0) {
    return { kind: "needs_attention", count: needsAttention };
  }
  const done = items.filter(
    (i) => i.status === "approved" || i.status === "na",
  ).length;
  if (done < items.length) {
    return { kind: "outstanding", done, total: items.length };
  }
  return { kind: "all_set" };
}
