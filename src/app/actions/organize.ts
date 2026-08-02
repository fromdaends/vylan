"use server";

// AI ORGANIZE — review actions (Files v2 §3).
//
// The scanner proposes; these actions are the HUMAN side. Approve executes
// through the exact server actions manual work uses (moveDocumentAction,
// deleteDocumentAction), so the audit trail is identical — attributed to the
// approving user, with ai_suggested: true in the metadata. The AI itself
// never mutates anything: an unreviewed suggestion is just a row.
//
// Reads and status updates go through the SESSION client on purpose: RLS
// scopes suggestions to the caller's firm and hides private clients' rows,
// so there is no hand-rolled permission check to get wrong.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { enqueueJob } from "@/lib/db/jobs";
import {
  deleteDocumentAction,
  moveDocumentAction,
} from "@/app/actions/documents";
import { stateMatches, type OrganizeBucket, type ScanRow } from "@/lib/files/organize";
import { revalidatePath } from "next/cache";

export type ReviewDecision = "approve" | "skip" | "dismiss";

export type ReviewResult =
  | { ok: true; outcome: "approved" | "skipped" | "dismissed" }
  | { ok: false; error: "expired" | "not_found" | "error" };

/** Queue an on-demand scan for THIS firm. Returns whether one was queued or
 * was already waiting — the UI says "scanning…" either way. */
export async function requestOrganizeScanAction(): Promise<{
  ok: boolean;
  alreadyQueued: boolean;
}> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, alreadyQueued: false };
  const sb = await getServerSupabase();
  const { data: pending } = await sb
    .from("jobs")
    .select("id")
    .eq("kind", "organize_scan")
    .eq("status", "pending")
    .eq("payload->>firm_id", firm.id)
    .limit(1);
  if (pending && pending.length > 0) return { ok: true, alreadyQueued: true };
  await enqueueJob({
    kind: "organize_scan",
    payload: { firm_id: firm.id },
    runAfter: new Date(),
  });
  return { ok: true, alreadyQueued: false };
}

export async function reviewSuggestionAction(input: {
  id: string;
  decision: ReviewDecision;
}): Promise<ReviewResult> {
  const firm = await getCurrentFirm();
  if (!firm || !input.id) return { ok: false, error: "error" };
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();

  const { data: s } = await sb
    .from("organize_suggestions")
    .select(
      "id, source, document_id, bucket, current_state, proposed_state, status",
    )
    .eq("id", input.id)
    .eq("status", "open")
    .maybeSingle();
  if (!s) return { ok: false, error: "not_found" };

  const review = {
    reviewed_at: new Date().toISOString(),
    reviewed_by: auth.user?.id ?? null,
  };

  if (input.decision === "skip" || input.decision === "dismiss") {
    const status = input.decision === "skip" ? "skipped" : "dismissed";
    const { error } = await sb
      .from("organize_suggestions")
      .update({ status, ...review })
      .eq("id", input.id)
      .eq("status", "open");
    if (error) return { ok: false, error: "error" };
    revalidatePath("/files");
    return { ok: true, outcome: status === "skipped" ? "skipped" : "dismissed" };
  }

  // ── approve ──────────────────────────────────────────────────────────────
  // The document must still be EXACTLY what the suggestion was about. A file
  // renamed, re-filed, or re-typed since the scan expires the suggestion
  // instead of firing a stale change at it.
  const { data: docRow } = await sb
    .from("firm_documents")
    .select(
      "source, id, firm_id, client_id, display_name, original_filename, ai_doc_type, ai_confidence, manual_doc_type, browse_year, browse_category, folder_id, content_hash, created_at",
    )
    .eq("source", s.source)
    .eq("id", s.document_id)
    .is("deleted_at", null)
    .maybeSingle();

  const asScanRow = (r: Record<string, unknown>): ScanRow => ({
    source: String(r.source),
    id: String(r.id),
    firm_id: String(r.firm_id),
    client_id: String(r.client_id),
    name:
      (typeof r.display_name === "string" && r.display_name.trim()) ||
      String(r.original_filename ?? ""),
    ai_doc_type: (r.ai_doc_type as string | null) ?? null,
    ai_confidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
    manual_doc_type: (r.manual_doc_type as string | null) ?? null,
    browse_year: (r.browse_year as number | null) ?? null,
    browse_category: (r.browse_category as string | null) ?? null,
    folder_id: (r.folder_id as string | null) ?? null,
    content_hash: (r.content_hash as string | null) ?? null,
    created_at: String(r.created_at),
  });

  if (!docRow || !stateMatches(s.current_state, asScanRow(docRow))) {
    await sb
      .from("organize_suggestions")
      .update({ status: "expired", ...review })
      .eq("id", input.id)
      .eq("status", "open");
    revalidatePath("/files");
    return { ok: false, error: "expired" };
  }

  const bucket = s.bucket as OrganizeBucket;
  const proposed = (s.proposed_state ?? {}) as {
    doc_type?: string | null;
    year?: number | null;
    category?: string | null;
    action?: string;
  };

  let applied: { ok: boolean };
  if (bucket === "duplicate") {
    applied = await deleteDocumentAction({
      source: s.source,
      id: s.document_id,
      aiSuggested: true,
    });
  } else {
    applied = await moveDocumentAction({
      source: s.source,
      id: s.document_id,
      // MoveInput semantics: "" = leave that axis alone.
      docType: proposed.doc_type ?? "",
      year: proposed.year != null ? String(proposed.year) : "",
      category: proposed.category ?? "",
      aiSuggested: true,
    });
  }
  if (!applied.ok) return { ok: false, error: "error" };

  await sb
    .from("organize_suggestions")
    .update({ status: "approved", ...review })
    .eq("id", input.id)
    .eq("status", "open");
  revalidatePath("/files");
  return { ok: true, outcome: "approved" };
}

/** Approve every open suggestion in one bucket. The CONFIRMATION happens in
 * the UI before this is called — with the exact counts — per the spec; this
 * just executes, one document at a time through the same path as a single
 * approval, and reports honestly what happened. */
export async function bulkApproveBucketAction(input: {
  bucket: OrganizeBucket;
}): Promise<{ approved: number; expired: number; failed: number }> {
  const firm = await getCurrentFirm();
  const out = { approved: 0, expired: 0, failed: 0 };
  if (!firm) return out;
  const sb = await getServerSupabase();
  const { data } = await sb
    .from("organize_suggestions")
    .select("id")
    .eq("status", "open")
    .eq("bucket", input.bucket)
    .limit(100);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const res = await reviewSuggestionAction({ id: row.id, decision: "approve" });
    if (res.ok) out.approved++;
    else if (res.error === "expired") out.expired++;
    else out.failed++;
  }
  return out;
}
