"use server";

// Management actions on a document in the Files browser.
//
// This PR covers the NON-DESTRUCTIVE ones — rename, move, and recording a
// download. Soft delete, restore and the bulk variants land next, together with
// the sweep that hides deleted documents from every other reader in the
// product; shipping a delete button before that sweep would mean a "deleted"
// file still showing in the client portal.
//
// THREE RULES EVERY ACTION HERE FOLLOWS:
//
//  1. AUTHORIZE THROUGH RLS, NEVER THE SERVICE ROLE. The three document tables
//     have three different visibility rules (private clients, private
//     engagements, assigned staff — see lib/files/serve-document.ts), and the
//     database already encodes all of them. Every write below is an UPDATE
//     through the session client with a WHERE on the id: if the caller cannot
//     see the row, the update matches zero rows and returns not_found. No
//     hand-rolled permission check to get wrong.
//
//  2. AUDIT AFTER THE WRITE LANDS, NEVER BEFORE. A logged action that did not
//     happen is worse than an unlogged one — it is a false record.
//
//  3. NOTHING TOUCHES THE ORIGINAL FILE. Rename changes a display name; move
//     changes two folder columns. The bytes in storage, and any copy already
//     filed out to the firm's cloud storage, are untouched.

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";
import { isDocumentSource } from "@/lib/files/serve-document";
import { sanitizeDisplayName } from "@/lib/files/display-name";
import { buildMovePatch } from "@/lib/files/move";
import { restoreDocument, softDeleteDocument } from "@/lib/db/document-delete";
import type { DocumentSource } from "@/lib/db/documents";

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "invalid" | "unavailable" | "error" };

const TABLE: Record<DocumentSource, string> = {
  checklist: "uploaded_files",
  final: "final_documents",
  imported: "imported_documents",
};


/** Rename = display name only. The uploaded file keeps its original name, and
 * nothing is re-filed. */
export async function renameDocumentAction(input: {
  source: string;
  id: string;
  name: string;
}): Promise<DocumentActionResult> {
  if (!isDocumentSource(input.source) || !input.id) {
    return { ok: false, error: "invalid" };
  }
  const name = sanitizeDisplayName(input.name ?? "");
  if (!name) return { ok: false, error: "invalid" };

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };
  const sb = await getServerSupabase();

  // RLS is the permission check: no visible row, no update.
  const { data, error } = await sb
    .from(TABLE[input.source])
    .update({ display_name: name })
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (!data) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "file_renamed", {
    source: input.source,
    file_id: input.id,
    new_name: name,
  });
  revalidatePath("/files");
  return { ok: true };
}

export type MoveInput = {
  source: string;
  id: string;
  /** "" = leave the type alone; "none" = clear it. */
  docType?: string | null;
  /** "" = leave alone; "unsorted" = the Unsorted bucket; else a year. */
  year?: string | null;
  /** "" = leave alone; "unsorted" = Unsorted; else a category code. */
  category?: string | null;
};

/**
 * Move = re-file a document under a different year and/or category, and
 * optionally set its document type by hand.
 *
 * Setting the TYPE auto-fills the category (a T4 is a federal slip), which is
 * what makes hand-sorting an import bearable — but the category can still be
 * overridden explicitly, so the caller's own category always wins if it sent
 * one.
 *
 * Every axis this touches is flagged MANUAL, which is what stops a later
 * re-classification quietly undoing the decision (see lib/files/axes.ts).
 */
export async function moveDocumentAction(
  input: MoveInput,
): Promise<DocumentActionResult> {
  if (!isDocumentSource(input.source) || !input.id) {
    return { ok: false, error: "invalid" };
  }

  const built = buildMovePatch(input.source, {
    docType: input.docType,
    year: input.year,
    category: input.category,
  });
  if (!built.ok) return { ok: false, error: "invalid" };
  const patch = built.patch;

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };
  const sb = await getServerSupabase();

  const { data, error } = await sb
    .from(TABLE[input.source])
    .update(patch)
    .eq("id", input.id)
    .select("id, browse_year, browse_category")
    .maybeSingle();
  if (error) {
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (!data) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "file_moved", {
    source: input.source,
    file_id: input.id,
    year: data.browse_year ?? null,
    category: data.browse_category ?? null,
    doc_type: (patch.manual_doc_type as string | null) ?? undefined,
  });
  revalidatePath("/files");
  return { ok: true };
}

/**
 * Move a document to the recycle bin. Recoverable for 30 days.
 *
 * Never a permanent delete: that only ever happens from the purge cron, once
 * the window has expired. The accountant's "delete" is always undoable.
 */
export async function deleteDocumentAction(input: {
  source: string;
  id: string;
}): Promise<DocumentActionResult> {
  if (!isDocumentSource(input.source) || !input.id) {
    return { ok: false, error: "invalid" };
  }
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();

  const res = await softDeleteDocument(
    input.source,
    input.id,
    auth.user?.id ?? null,
  );
  if (!res.ok) return res;

  await logUserActivity(firm.id, null, "file_deleted", {
    source: input.source,
    file_id: input.id,
  });
  revalidatePath("/files");
  return { ok: true };
}

/** Bring a document back out of the recycle bin. */
export async function restoreDocumentAction(input: {
  source: string;
  id: string;
}): Promise<DocumentActionResult> {
  if (!isDocumentSource(input.source) || !input.id) {
    return { ok: false, error: "invalid" };
  }
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };

  const res = await restoreDocument(input.source, input.id);
  if (!res.ok) return res;

  await logUserActivity(firm.id, null, "file_restored", {
    source: input.source,
    file_id: input.id,
  });
  revalidatePath("/files");
  return { ok: true };
}

/**
 * Record that someone downloaded a document.
 *
 * Called by the client AFTER the browser has been pointed at the bytes, so it
 * cannot block or delay the download. That does mean a download can in
 * principle happen without a log line (the tab closes mid-request) — an honest
 * trade: the alternative is routing every download through a server action and
 * losing HTTP range streaming, which is what makes a 200-page PDF readable.
 * The bytes route itself is still fully authorized either way.
 */
export async function logDocumentDownloadAction(input: {
  source: string;
  id: string;
}): Promise<{ ok: boolean }> {
  if (!isDocumentSource(input.source) || !input.id) return { ok: false };
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false };
  // Prove the caller can actually see this document before writing a log line
  // that says they downloaded it — otherwise the endpoint is a way to forge
  // audit entries about documents you cannot read.
  const sb = await getServerSupabase();
  const { data } = await sb
    .from(TABLE[input.source])
    .select("id")
    .eq("id", input.id)
    .maybeSingle();
  if (!data) return { ok: false };

  await logUserActivity(firm.id, null, "file_downloaded", {
    source: input.source,
    file_id: input.id,
  });
  return { ok: true };
}

// PGRST204/42703 = missing column, PGRST205/42P01 = missing table. Pre-1070
// environments simply have no Files feature; say so rather than "error".
function isSchemaMissing(err: { code?: string | null } | null): boolean {
  return (
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    err?.code === "PGRST205" ||
    err?.code === "42P01"
  );
}
