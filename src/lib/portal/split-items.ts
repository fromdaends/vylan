import type { RequestItem } from "@/lib/db/request-items";

export type SplitPortalItems = {
  // Normal document-collection items (the client uploads documents).
  collection: RequestItem[];
  // Signature items (the accountant supplied a document; the client returns a
  // signed copy). Rendered under the portal's "To sign" group.
  signatures: RequestItem[];
};

// Split the portal's single flat item list into the document-collection items
// and the signature items, preserving order within each group. A signature
// item is any item with kind === 'signature'; everything else (including legacy
// rows where kind defaults to 'collection') is a document item. Kept pure +
// tested so the grouping is a single source of truth shared by the portal UI.
export function splitPortalItems(items: RequestItem[]): SplitPortalItems {
  const collection: RequestItem[] = [];
  const signatures: RequestItem[] = [];
  for (const item of items) {
    if (item.kind === "signature") signatures.push(item);
    else collection.push(item);
  }
  return { collection, signatures };
}
