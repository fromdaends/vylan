// FIRM-WIDE file tools for the read-only assistant (Files v2 §4).
//
// The engagement-scoped document tools answer "what's in THIS engagement";
// these two answer "do we have…" and "what does it say" across the whole
// firm — the questions people actually ask a chat ("do we have Zachary's
// 2025 T4", "summarize the lease in his 2026 folder").
//
// Everything reads through the SESSION client, so RLS applies exactly as it
// does in Browse: firm isolation, private clients, soft-delete. Firm-only
// documents ARE included — this assistant serves the firm side only, and
// nothing here is reachable from any client surface.
//
// The assistant still takes no actions. That refusal lives in the system
// prompt (pointing at AI Organize), and the general assistant is never given
// a propose_* tool in the first place.

import {
  listDocuments,
  listDocumentsByIds,
  searchDocumentContent,
  type BrowseDocument,
  type DocumentSource,
} from "@/lib/db/documents";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_RESULTS = 12;
const MAX_TEXT_CHARS = 6000;

/** The document's spot in Browse — the link the model cites. A filed document
 * links to its folder (its derived view no longer lists it). */
function docLink(d: BrowseDocument): string {
  if (d.folderId) return `/files?client=${d.clientId}&folder=${d.folderId}`;
  const year = d.year != null ? String(d.year) : "unsorted";
  const category = d.category ?? "unsorted";
  return `/files?client=${d.clientId}&year=${year}&category=${category}`;
}

function compact(
  d: BrowseDocument,
  clientNames: Map<string, string>,
  extra: Record<string, unknown> = {},
) {
  return {
    source: d.source,
    file_id: d.id,
    name: d.name,
    client: clientNames.get(d.clientId) ?? null,
    year: d.year,
    doc_type: d.docType,
    firm_only: d.visibility === "firm",
    link: docLink(d),
    preview_link: `/api/files/${d.id}?source=${d.source}`,
    ...extra,
  };
}

async function clientNamesFor(
  sb: SupabaseClient,
  docs: BrowseDocument[],
): Promise<Map<string, string>> {
  const ids = [...new Set(docs.map((d) => d.clientId))];
  if (ids.length === 0) return new Map();
  const { data } = await sb.from("clients").select("id, display_name").in("id", ids);
  return new Map(
    ((data ?? []) as Array<{ id: string; display_name: string }>).map((c) => [
      c.id,
      c.display_name,
    ]),
  );
}

export async function findFiles(
  sb: SupabaseClient,
  input: unknown,
): Promise<unknown> {
  const i = (input ?? {}) as { query?: unknown; client_name?: unknown };
  const query = typeof i.query === "string" ? i.query.trim() : "";
  if (!query) return { error: "query is required." };
  const clientName =
    typeof i.client_name === "string" ? i.client_name.trim() : "";

  // Same merge Browse search performs: name/metadata hits, plus hits found
  // INSIDE documents the AI has read, fetched when the name search missed them.
  const page = await listDocuments({ search: query, page: 1 });
  if (!page.available) return { error: "Files is not available." };
  const { hits } = await searchDocumentContent(query, 20);
  const snippetByKey = new Map(
    hits.map((h) => [`${h.source}|${h.documentId}`, h.snippet]),
  );
  const have = new Set(page.documents.map((d) => `${d.source}|${d.id}`));
  const extras = await listDocumentsByIds(
    hits
      .filter((h) => !have.has(`${h.source}|${h.documentId}`))
      .map((h) => ({ source: h.source, id: h.documentId })),
  );

  let docs = [...page.documents, ...extras];

  // Optional client narrowing, by display name, accent-insensitive enough for
  // a chat ("tremblay" finds "TEST — Jean Tremblay").
  if (clientName) {
    const { data } = await sb
      .from("clients")
      .select("id")
      .ilike("display_name", `%${clientName}%`);
    const ids = new Set(((data ?? []) as Array<{ id: string }>).map((c) => c.id));
    docs = docs.filter((d) => ids.has(d.clientId));
  }

  const total = docs.length;
  docs = docs.slice(0, MAX_RESULTS);
  const names = await clientNamesFor(sb, docs);

  return {
    total_matches: total,
    shown: docs.length,
    note:
      "Content matches only exist for documents the AI has read (new portal uploads). Older files match by name and details only.",
    results: docs.map((d) => {
      const snippet = snippetByKey.get(`${d.source}|${d.id}`);
      return compact(d, names, {
        matched: snippet ? "content" : "name",
        // ts_headline's <b> markers stripped: this text goes back into a
        // prompt, not a page — the emphasis is noise there.
        snippet: snippet ? snippet.replace(/<\/?b>/g, "") : undefined,
      });
    }),
  };
}

export async function readFile(
  sb: SupabaseClient,
  input: unknown,
): Promise<unknown> {
  const i = (input ?? {}) as { source?: unknown; file_id?: unknown };
  const source = typeof i.source === "string" ? i.source : "";
  const fileId = typeof i.file_id === "string" ? i.file_id : "";
  if (!["checklist", "final", "imported"].includes(source) || !fileId) {
    return { error: "source (checklist|final|imported) and file_id are required." };
  }

  const [doc] = await listDocumentsByIds([
    { source: source as DocumentSource, id: fileId },
  ]);
  if (!doc) return { error: "Document not found (or not visible to you)." };
  const names = await clientNamesFor(sb, [doc]);

  const { data: textRow } = await sb
    .from("document_texts")
    .select("extracted_text")
    .eq("source", source)
    .eq("document_id", fileId)
    .maybeSingle();
  const text = textRow?.extracted_text ?? null;

  return {
    ...compact(doc, names),
    doc_type_label: doc.docType
      ? DOC_TYPE_LABELS[doc.docType].en.split(" — ")[0]
      : null,
    text: text ? text.slice(0, MAX_TEXT_CHARS) : null,
    text_truncated: !!text && text.length > MAX_TEXT_CHARS,
    note: text
      ? undefined
      : "No stored text for this document — only files the AI has read at portal intake have text. The metadata above is still accurate.",
  };
}
