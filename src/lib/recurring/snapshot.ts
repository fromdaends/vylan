// Build a series' checklist snapshot (TemplateItem[]) from an existing
// engagement's request items — used when the accountant turns Repeat ON for
// an engagement that already exists. Pure so it's unit-tested directly.
//
// Signature items are deliberately EXCLUDED: they reference a specific blank
// document the accountant uploaded to THIS engagement, which future
// occurrences can't reuse (each period's document to sign is different).
// v1 series carry the document-collection checklist only.

import type { TemplateItem, DocType } from "@/lib/db/templates";
import type { RequestItem } from "@/lib/db/request-items";

type SnapshotSource = Pick<
  RequestItem,
  | "label"
  | "label_fr"
  | "description"
  | "description_fr"
  | "doc_type"
  | "required"
  | "kind"
>;

export function snapshotFromRequestItems(
  items: SnapshotSource[],
): TemplateItem[] {
  return items
    .filter((item) => item.kind !== "signature")
    .map((item) => ({
      // request_items stores EN in `label` / `description`; a series snapshot
      // uses the template shape (label_en/label_fr). Fall back across
      // languages so a single-language item never snapshots as blank.
      label_en: item.label || item.label_fr || "",
      label_fr: item.label_fr || item.label || "",
      description_en: item.description ?? item.description_fr ?? null,
      description_fr: item.description_fr ?? item.description ?? null,
      doc_type: item.doc_type as DocType,
      required: item.required,
    }))
    .filter((item) => item.label_en.length > 0 || item.label_fr.length > 0);
}
