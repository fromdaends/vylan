// The ONE rule that decides whether the unauthenticated client portal may serve
// the blank document an accountant uploaded for a signature item (the
// "document to sign"). That file lives on `request_items.signing_doc_path`, NOT
// `uploaded_files`, so the uploaded-file endpoints don't cover it — but the
// authorization must be exactly as strict: the magic token must resolve to the
// engagement that owns the item, the engagement must be live (not cancelled /
// expired), the item must belong to THAT engagement, and it must actually be a
// signature item with a stored document.
//
// Kept PURE and exhaustively unit-tested so the access rule is one provable
// source of truth, not just hidden in the UI. The route fetches the engagement
// (by magic_token) and the item (by id) with the service-role client, then calls
// this; it serves bytes only when this returns true, and returns an
// indistinguishable 404 otherwise (no existence oracle).

import {
  isPortalFileAccessAllowed,
  type PortalEngagementRow,
} from "./file-access";

export type SigningDocItemRow = {
  engagement_id: string;
  kind: "collection" | "signature";
  signing_doc_path: string | null;
} | null;

export function isSigningDocAccessAllowed(input: {
  // Result of isValidTokenShape(token) — a malformed token never hits the DB.
  tokenShapeValid: boolean;
  // The engagement the token resolved to, or null if no engagement matched.
  engagement: PortalEngagementRow;
  // The requested item row, or null if no item matched that id.
  item: SigningDocItemRow;
  now?: Date;
}): boolean {
  const { tokenShapeValid, engagement, item, now } = input;

  // Reuse the proven uploaded-file rule by treating the ITEM as the
  // engagement-scoped row: it enforces token shape, engagement match, not
  // cancelled, not expired, AND that the item belongs to this engagement —
  // the decisive cross-client isolation check.
  if (
    !isPortalFileAccessAllowed({
      tokenShapeValid,
      engagement,
      file: item ? { engagement_id: item.engagement_id } : null,
      now,
    })
  ) {
    return false;
  }

  // Signature-specific: only a signature item has a document-to-sign, and only
  // when one was actually stored. A collection item (or a signature item with
  // no stored path) is an indistinguishable 404 — never an existence oracle.
  if (!item) return false;
  if (item.kind !== "signature") return false;
  if (
    typeof item.signing_doc_path !== "string" ||
    item.signing_doc_path.trim() === ""
  ) {
    return false;
  }

  return true;
}
