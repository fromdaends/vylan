// Delete a QuickBooks draft entirely (remove it from the queue) via a STABLE URL
// endpoint. Unlike "undo" (which returns a posted draft to 'approved' and keeps
// the row), delete removes the local suggestion row.
//
// A draft Vylan actually POSTED to QuickBooks must be deleted in QuickBooks FIRST
// (same as undo) or we'd orphan a live transaction. A MATCHED posted draft points
// at a transaction that was already in QuickBooks (Vylan never created it), so we
// only unlink locally — nothing is deleted in QuickBooks. Non-posted drafts
// (draft / approved / dismissed) just have their row removed, no QuickBooks call.
//
// Auth + the RLS-scoped read (getDraftForFile) is the authorization; the delete
// itself runs service-role because authenticated users have no delete grant.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getDraftForFile,
  deleteTransactionSuggestionForFile,
  recordDraftVoided,
} from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksDelete, QuickbooksError } from "@/lib/quickbooks/client";
import {
  effectiveExpenseMode,
  effectiveIncomeMode,
} from "@/lib/quickbooks/draft-resolve";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

function revalidate(engagementId: string) {
  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/quickbooks/drafts`);
    revalidatePath(`/${loc}/engagements/${engagementId}`);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  const draft = await getDraftForFile(fileId);
  if (!draft) {
    return NextResponse.json(
      { error: "not_found", detail: "Draft not found." },
      { status: 404 },
    );
  }

  // NOTE (accepted narrow race): if a draft is deleted in the ~sub-second window
  // between the post route creating the QuickBooks transaction and recording it
  // (status is still 'approved', postedQboId still null), this can't void that
  // fresh transaction and would remove the local row — orphaning it in
  // QuickBooks. This requires two concurrent actions on the same draft and
  // mirrors the existing reopen-mid-post race; the post route surfaces a
  // "conflict — check QuickBooks" message. A full fix needs a posting marker in
  // the post route.
  const isPosted = draft.status === "posted" && !!draft.postedQboId;
  const matched = draft.matchedQboType != null;
  if (isPosted && !matched) {
    const ctx = await getQuickbooksReadContext(draft.firmId);
    if (!ctx) {
      return NextResponse.json(
        {
          error: "not_connected",
          detail:
            "Reconnect QuickBooks to delete a posted draft, or undo it first.",
        },
        { status: 409 },
      );
    }
    // Mirror the entity the post used (see post.ts / void route): PAID income ->
    // SalesReceipt, unpaid income -> Invoice; PAID expense -> Purchase, unpaid ->
    // Bill. Deleting via the wrong endpoint fails.
    const entity =
      draft.suggestion?.direction === "income"
        ? effectiveIncomeMode(draft.suggestion, draft.resolved) ===
          "salesreceipt"
          ? "salesreceipt"
          : "invoice"
        : draft.suggestion &&
            effectiveExpenseMode(draft.suggestion, draft.resolved) ===
              "purchase"
          ? "purchase"
          : "bill";
    try {
      await quickbooksDelete(
        ctx,
        entity,
        draft.postedQboId!,
        draft.postedSyncToken ?? "0",
      );
    } catch (e) {
      const detail =
        e instanceof QuickbooksError ? e.message : (e as Error).message;
      return NextResponse.json({ error: "delete_failed", detail }, {
        status: 502,
      });
    }
  }

  // For a posted draft, reset the row to a clean 'approved' state (clears the
  // posted / matched linkage) BEFORE removing it. If the row removal below fails
  // transiently, a retry then deletes a plain local row instead of trying to
  // re-void the already-deleted QuickBooks transaction (which would 502 forever).
  if (draft.status === "posted") {
    await recordDraftVoided({
      uploadedFileId: fileId,
      nextAttempt: draft.postAttempt + 1,
    });
  }

  const removed = await deleteTransactionSuggestionForFile(fileId);
  revalidate(draft.engagementId);
  if (!removed) {
    return NextResponse.json(
      {
        error: "record_failed",
        detail:
          "The QuickBooks side was updated, but the draft couldn't be removed. Refresh and try again.",
      },
      { status: 500 },
    );
  }

  try {
    await logUserActivity(draft.firmId, draft.engagementId, "delete_qbo_draft", {
      file_id: fileId,
      // Was a posted transaction removed from QuickBooks, or was this only a
      // local draft / an unlinked match?
      was_posted: (isPosted && !matched) || undefined,
      unlinked_match: (isPosted && matched) || undefined,
    });
  } catch (err) {
    console.error("[qbo delete route] audit log failed (delete applied):", err);
  }

  return NextResponse.json({ ok: true });
}
