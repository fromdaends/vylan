// Resolving + AUTHORIZING one document for byte serving, whichever of the three
// tables it lives in.
//
// The Files browser can open a checklist upload, one of the firm's own
// deliverables, or an imported historical file. All three stream through the
// same proxy routes, so the lookup and — far more importantly — the
// authorization has to be in exactly one place.
//
// AUTHORIZATION IS PER SOURCE, because the three tables genuinely do not share
// a rule (verified in the Phase 0 audit, not assumed):
//
//   uploaded_files      gates through an EXISTS join to engagements, so it
//                       inherits 0810 private clients, 0850 private
//                       engagements AND 0990's assigned-staff relaxation.
//   final_documents     gates on engagement_is_private(), which 0990
//                       deliberately did NOT relax. Deliverables on a private
//                       engagement stay owner-only — STRICTER than the parent
//                       engagement's own rule.
//   imported_documents  gates on client_is_private() (1070). It has no
//                       engagement, so there is nothing to be assigned to.
//
// That last point is why this cannot be "join to the engagement and check the
// firm" for everything: for final_documents that would be LOOSER than the
// table's own policy and would hand an assigned staff member a private client's
// deliverables. Reading each row through the RLS session client asks the
// database the right question every time.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import type { DocumentSource } from "@/lib/db/documents";

export function isDocumentSource(v: unknown): v is DocumentSource {
  return v === "checklist" || v === "final" || v === "imported";
}

/** Parse a `?source=` param, defaulting to the historical behaviour. */
export function sourceFromParam(v: string | null | undefined): DocumentSource {
  return isDocumentSource(v) ? v : "checklist";
}

export type ServableDocument = {
  source: DocumentSource;
  id: string;
  storagePath: string;
  mimeType: string;
  /** display_name ?? original_filename — what a download should be called. */
  fileName: string;
  deletedAt: string | null;
  /**
   * What the document hangs off, so a download's audit row can name the work
   * and link to it. Exactly one is set per source: checklist uploads and
   * deliverables belong to an engagement; an import belongs to a client and has
   * no engagement at all (1070 gave imported_documents client_id, not
   * engagement_id).
   */
  engagementId: string | null;
  clientId: string | null;
  /**
   * Who asked for it. Established here from the session, and handed back rather
   * than re-derived by the caller: auth.getUser() re-validates against the auth
   * server on every call, and a download's audit row must not cost the reader a
   * second round trip before the first byte.
   */
  actorId: string;
};

/**
 * Find a document and prove the caller may read it, or return null.
 *
 * Null is returned for "does not exist" AND "not yours" alike — callers turn
 * both into an indistinguishable 404 so the endpoint is never an existence
 * oracle for another firm's documents.
 */
export async function resolveServableDocument(
  source: DocumentSource,
  id: string,
): Promise<ServableDocument | null> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const firm = await getCurrentFirm();
  if (!firm) return null;

  if (source === "checklist") {
    // PRESERVED VERBATIM from the original route rather than rewritten to match
    // the branches below. This is the hot path every document preview in the
    // product already uses, and it is security-critical; an equivalent-looking
    // refactor of it buys nothing and risks everything. The service role finds
    // the row, then the AUTHED client re-asks whether this user may see the
    // parent engagement — which is what applies 0810/0850/0990.
    const sb = getServiceRoleSupabase();
    const { data: file } = await sb
      .from("uploaded_files")
      .select(
        "storage_path, original_filename, display_name, mime_type, engagement_id, deleted_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (!file) return null;
    const { data: engagement } = await supabase
      .from("engagements")
      .select("id")
      .eq("id", file.engagement_id as string)
      .eq("firm_id", firm.id)
      .maybeSingle();
    if (!engagement) return null;
    return {
      source,
      id,
      storagePath: file.storage_path as string,
      mimeType: (file.mime_type as string | null) ?? "",
      fileName:
        (file.display_name as string | null) ?? (file.original_filename as string),
      // Pre-1070 environments have no such column; undefined reads as null.
      deletedAt: (file.deleted_at as string | null) ?? null,
      engagementId: (file.engagement_id as string | null) ?? null,
      clientId: null,
      actorId: auth.user.id,
    };
  }

  // final_documents and imported_documents are read through the RLS client
  // directly, so each table's own policy is the gate — no join that could be
  // more permissive than the table itself.
  const table = source === "final" ? "final_documents" : "imported_documents";
  // Same query, one differing column: the two tables genuinely scope
  // differently (a deliverable to an engagement, an import to a client), and
  // asking either for the other's column would error the whole select.
  const scopeColumn = source === "final" ? "engagement_id" : "client_id";
  const { data, error } = await supabase
    .from(table)
    .select(
      `id, storage_path, original_filename, display_name, mime_type, deleted_at, ${scopeColumn}`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    source,
    id,
    storagePath: data.storage_path as string,
    mimeType: (data.mime_type as string | null) ?? "",
    fileName:
      (data.display_name as string | null) ?? (data.original_filename as string),
    deletedAt: (data.deleted_at as string | null) ?? null,
    engagementId:
      source === "final"
        ? ((data as { engagement_id?: string | null }).engagement_id ?? null)
        : null,
    clientId:
      source === "imported"
        ? ((data as { client_id?: string | null }).client_id ?? null)
        : null,
    actorId: auth.user.id,
  };
}
