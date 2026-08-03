import type { BrowseDocument } from "@/lib/db/documents";

// The identity the document action menus act on, derived from a document row.
//
// Lives in a NEUTRAL module — not beside the menu components, which are
// "use client". A value exported from a "use client" file turns into a stub
// when a Server Component imports it, and every check in the repo (tsc,
// eslint, tests, build) sails straight past that; the feature just quietly
// stops working. Both callers here are Server Components, so this has to be
// somewhere neither side has to think about.
//
// ONE builder, because the ⋯ button, the row right-click on Browse, and the
// row right-click on Home must all act on exactly the same document. Three
// hand-written copies of this object is how "rename works in Browse but moves
// the wrong file on Home" starts.
export function docMenuMeta(doc: BrowseDocument) {
  return {
    source: doc.source,
    id: doc.id,
    name: doc.name,
    year: doc.year,
    category: doc.category,
    docType: doc.docType,
    // Move is disabled only while the AI is genuinely mid-read; its answer
    // would land on top of the person's. An imported or never-analysed
    // document is always movable — hand-sorting is the whole point of them.
    canMove: !doc.classificationPending,
    visibility: doc.visibility,
  };
}
