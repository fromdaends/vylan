import type { RequestItem } from "@/lib/db/request-items";

export type SplitPortalItems = {
  // Normal document-collection items (the client uploads documents).
  collection: RequestItem[];
  // Signature items (the accountant supplied a document; the client returns a
  // signed copy). Rendered under the portal's "To sign" group.
  signatures: RequestItem[];
  // Question items (1170): the client answers in words, not with a file.
  //
  // These are NOT a third portal group. A question is another thing the client
  // owes the firm, exactly like a document, so it stays in the same checklist
  // and in the same order — only its card differs, because a dropzone is the
  // wrong control for "what was this for?". The split exists so the document
  // card is never rendered for one, not to move it somewhere else.
  questions: RequestItem[];
};

// Split the portal's single flat item list by kind, preserving order within
// each group. Everything that is not explicitly a signature or a question is a
// document item — including legacy rows where kind defaults to 'collection'.
// Kept pure + tested so the grouping is a single source of truth shared by the
// portal UI.
export function splitPortalItems(items: RequestItem[]): SplitPortalItems {
  const collection: RequestItem[] = [];
  const signatures: RequestItem[] = [];
  const questions: RequestItem[] = [];
  for (const item of items) {
    if (item.kind === "signature") signatures.push(item);
    else if (item.kind === "question") questions.push(item);
    else collection.push(item);
  }
  return { collection, signatures, questions };
}

// Everything on the client's checklist that is not a signature — documents and
// questions together, in the order the engagement put them.
//
// Order matters and is why this is a filter over the original list rather than
// the two split buckets concatenated: the firm decides what to ask for first,
// and a question about the March bank charge should sit where it was put, not
// after every document because questions were a later feature.
export function portalChecklist(items: RequestItem[]): RequestItem[] {
  return items.filter((i) => i.kind !== "signature");
}

// Has the client answered this question?
//
// The answer text is the fact, not the status: an item can be moved through the
// status machinery by an accountant or a reminder, but only the client can put
// words in `answer_text`.
export function isAnswered(item: RequestItem): boolean {
  return Boolean(item.answer_text && item.answer_text.trim());
}
