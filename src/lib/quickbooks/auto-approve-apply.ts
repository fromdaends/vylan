// Gather what the auto-approve decision needs, and apply it.
//
// The decision itself is pure and lives in auto-approve.ts. This is the I/O
// half: read the firm's opt-in and the duplicate flag, ask, and flip the status
// if the answer is yes.
//
// Best-effort throughout. Unattended approval is a convenience; failing to
// evaluate it must never fail the classification that triggered it, and every
// error path resolves to "don't approve".

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { setDraftStatus } from "@/lib/db/quickbooks-suggestions";
import { decideAutoApprove } from "@/lib/quickbooks/auto-approve";
import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";

export async function maybeAutoApproveDraft(input: {
  firmId: string;
  clientId: string | null;
  fileId: string;
  suggestion: TransactionSuggestion;
}): Promise<boolean> {
  try {
    const sb = getServiceRoleSupabase();

    // The firm's opt-in. A missing column (pre-1000) reads as OFF, so the
    // feature simply stays dormant until the migration lands.
    const { data: firmRow, error: firmErr } = await sb
      .from("firms")
      .select("auto_approve_bookkeeping_drafts")
      .eq("id", input.firmId)
      .maybeSingle();
    if (firmErr || !firmRow) return false;
    const enabled =
      (firmRow as { auto_approve_bookkeeping_drafts?: boolean })
        .auto_approve_bookkeeping_drafts === true;
    if (!enabled) return false;

    // A suspected near-duplicate is never approved unattended. Read here rather
    // than threaded in, so this stays true however the caller changes.
    const { data: fileRow } = await sb
      .from("uploaded_files")
      .select("possible_duplicate_of_file_id")
      .eq("id", input.fileId)
      .maybeSingle();
    const possibleDuplicate =
      (fileRow as { possible_duplicate_of_file_id?: string | null } | null)
        ?.possible_duplicate_of_file_id != null;

    const decision = decideAutoApprove({
      enabled,
      suggestion: input.suggestion,
      // A freshly built draft has no accountant overrides yet — the whole point
      // is that nobody has touched it.
      resolved: null,
      possibleDuplicate,
    });
    if (!decision.approve) return false;

    // reviewerId null = approved by the system, not by a person. The card reads
    // this to say so rather than crediting someone who never looked at it.
    const ok = await setDraftStatus({
      uploadedFileId: input.fileId,
      status: "approved",
      reviewerId: null,
    });
    return ok === true;
  } catch (err) {
    console.warn("[auto-approve] evaluation failed:", err);
    return false;
  }
}
