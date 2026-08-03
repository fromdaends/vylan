// The one place a `request_items` row is shaped.
//
// There are two ways a checklist item is born — with the engagement
// (createEngagementWithItems) and afterwards (addItemToEngagement) — and they
// used to build the row independently. They drifted exactly where you would
// expect: the builder writes ONE description box and mirrored it only into
// `description_fr`, so every item created with an engagement stored a null
// English `description`, while items added later mirrored into both. The client
// portal reads the English column for an English client, so those clients saw
// no instructions at all on the original checklist — invisible from the firm's
// side, because the firm's editor always renders the French column.
//
// The labels already did this correctly (engagement-builder mirrors one input
// into label_fr + label_en, with a comment saying why). The description simply
// never got the same treatment. Rather than patch one caller, both now go
// through here.
//
// MIRRORING RULE: the product has ONE input per field, not one per language.
// Whichever side is supplied fills both columns, so neither language can end up
// empty while the other has text. Callers that genuinely have two translations
// can still pass both and nothing is overwritten.
//
// A plain module — no Supabase, no "use server" — so both db modules can import
// it without a cycle and it can be unit-tested directly.

export type RequestItemRowInput = {
  label?: string | null;
  label_fr?: string | null;
  description?: string | null;
  description_fr?: string | null;
  doc_type: string | null;
  required: boolean;
};

export type RequestItemRow = {
  engagement_id: string;
  label: string | null;
  label_fr: string | null;
  description: string | null;
  description_fr: string | null;
  doc_type: string | null;
  required: boolean;
  order_index: number;
};

// Empty string and whitespace count as absent — a textarea the user tabbed
// through should not win over the side that actually has text.
function firstFilled(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const at = a?.trim();
  if (at) return at;
  const bt = b?.trim();
  return bt || null;
}

// The READ side of the same column pair, kept here so the two halves cannot
// drift apart the way the two write paths did.
//
// Prefer the reader's language, then fall back to the other one. The fallback
// must run in BOTH directions: every item created before buildRequestItemRow
// existed stored its description only in `description_fr`, so an English client
// was shown nothing at all. There is no migration repairing those rows, so
// reading defensively is what fixes the engagements the founder already has.
// Showing a client the other language beats showing them a blank.
//
// Three portal cards (collection, signature, question) had a copy of the
// one-sided version each; the symmetric form already existed in files.zip,
// set-summary-line and recurring/snapshot. This is that pattern, named once.
// Overloaded so a caller passing a non-nullable fallback (item.label is
// `string`) gets `string` back and does not have to re-assert it. Labels are
// required; descriptions are genuinely optional and keep `string | null`.
export function pickItemText(
  locale: string,
  fr: string | null | undefined,
  en: string,
): string;
export function pickItemText(
  locale: string,
  fr: string | null | undefined,
  en: string | null | undefined,
): string | null;
export function pickItemText(
  locale: string,
  fr: string | null | undefined,
  en: string | null | undefined,
): string | null {
  const first = locale === "fr" ? fr : en;
  const second = locale === "fr" ? en : fr;
  if (first?.trim()) return first;
  if (second?.trim()) return second;
  // Both blank. Return `en` rather than null so the non-nullable overload
  // stays honest for a (pathological) all-whitespace label.
  return en ?? null;
}

export function buildRequestItemRow(
  engagementId: string,
  item: RequestItemRowInput,
  orderIndex: number,
): RequestItemRow {
  return {
    engagement_id: engagementId,
    label: firstFilled(item.label, item.label_fr),
    label_fr: firstFilled(item.label_fr, item.label),
    description: firstFilled(item.description, item.description_fr),
    description_fr: firstFilled(item.description_fr, item.description),
    doc_type: item.doc_type,
    required: item.required,
    order_index: orderIndex,
  };
}
