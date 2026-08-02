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
  /** Set when the move fires from an approved AI Organize suggestion. Same
   * code path, same audit event — plus this marker in the metadata, so the
   * log reads "approved an AI suggestion", attributed to the approver. */
  aiSuggested?: boolean;
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
    ai_suggested: input.aiSuggested || undefined,
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
  /** Approved AI Organize duplicate suggestion — see MoveInput.aiSuggested. */
  aiSuggested?: boolean;
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
    ai_suggested: input.aiSuggested || undefined,
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

// How many documents one bulk call may touch. Generous enough for a page of
// results plus room, bounded so a crafted request cannot ask the server to walk
// a firm's entire history inside one action.
const BULK_LIMIT = 200;

export type BulkResult = {
  ok: boolean;
  succeeded: number;
  failed: number;
  /** Items that were already in the requested state, so nothing moved. */
  skipped: number;
};

export type BulkTarget = { source: string; id: string };

function validTargets(targets: BulkTarget[] | undefined): BulkTarget[] {
  if (!Array.isArray(targets)) return [];
  return targets
    .filter((t) => t && isDocumentSource(t.source) && typeof t.id === "string" && t.id)
    .slice(0, BULK_LIMIT);
}

/**
 * Move several documents at once.
 *
 * This is the action that makes importing history bearable: a firm bringing in
 * ten years of files sorts them in batches, not one at a time. Founder's words:
 * nobody is going to sort 800 files individually.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT HIDDEN. Each document is moved on its own —
 * one failing (it was deleted a moment ago, or it belongs to a client this user
 * cannot see) must not abandon the other 199, and the caller is told the counts
 * so the UI can say "184 moved, 2 couldn't be" instead of a green tick that
 * covers a silent gap.
 */
export async function bulkMoveDocumentsAction(input: {
  targets: BulkTarget[];
  docType?: string | null;
  year?: string | null;
  category?: string | null;
}): Promise<BulkResult> {
  const targets = validTargets(input.targets);
  if (targets.length === 0) return { ok: false, succeeded: 0, failed: 0, skipped: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const t of targets) {
    const res = await moveDocumentAction({
      source: t.source,
      id: t.id,
      docType: input.docType,
      year: input.year,
      category: input.category,
    });
    if (res.ok) succeeded++;
    else failed++;
  }
  revalidatePath("/files");
  // No `skipped` here: moveDocumentAction stamps the manual-override flags even
  // when the value is unchanged, which is a real change — it pins the axis so
  // the AI cannot move it back. Reporting that as "nothing happened" would be
  // its own lie.
  return { ok: failed === 0, succeeded, failed, skipped: 0 };
}

/** Move several documents to the recycle bin. Same partial-success contract. */
export async function bulkDeleteDocumentsAction(input: {
  targets: BulkTarget[];
}): Promise<BulkResult> {
  const targets = validTargets(input.targets);
  if (targets.length === 0) return { ok: false, succeeded: 0, failed: 0, skipped: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const t of targets) {
    const res = await deleteDocumentAction({ source: t.source, id: t.id });
    if (res.ok) succeeded++;
    else failed++;
  }
  revalidatePath("/files");
  return { ok: succeeded > 0, succeeded, failed, skipped: 0 };
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

// ── Visibility: client-visible vs firm-only (Files v2 §6) ───────────────────

export type DocumentVisibility = "client" | "firm";

/**
 * Flip whether the client may ever see this document. 'firm' removes it from
 * every client-facing surface — enforced in the portal QUERIES, not the UI.
 * RLS is the permission check here, same as rename: no visible row, no update.
 */
export async function setDocumentVisibilityAction(input: {
  source: string;
  id: string;
  visibility: DocumentVisibility;
}): Promise<DocumentActionResult> {
  if (
    !isDocumentSource(input.source) ||
    !input.id ||
    (input.visibility !== "client" && input.visibility !== "firm")
  ) {
    return { ok: false, error: "invalid" };
  }
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };
  const sb = await getServerSupabase();

  const { data, error } = await sb
    .from(TABLE[input.source])
    .update({ visibility: input.visibility })
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (!data) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "file_visibility_changed", {
    source: input.source,
    file_id: input.id,
    visibility: input.visibility,
  });
  revalidatePath("/files");
  return { ok: true };
}

/** Bulk visibility flip. Same per-row path, honest partial reporting. */
export async function bulkSetVisibilityAction(input: {
  targets: BulkTarget[];
  visibility: DocumentVisibility;
}): Promise<BulkResult> {
  const targets = validTargets(input.targets);
  if (targets.length === 0) return { ok: false, succeeded: 0, failed: 0, skipped: 0 };
  let succeeded = 0;
  let failed = 0;
  for (const t of targets) {
    const res = await setDocumentVisibilityAction({
      source: t.source,
      id: t.id,
      visibility: input.visibility,
    });
    if (res.ok) succeeded++;
    else failed++;
  }
  revalidatePath("/files");
  return { ok: failed === 0, succeeded, failed, skipped: 0 };
}
