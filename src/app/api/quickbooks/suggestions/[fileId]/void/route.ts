// Undo a posted draft (Stage 5, Phase 1) via a STABLE URL endpoint: DELETE the
// transaction in QuickBooks (a Bill can't be voided via the API — QuickBooks
// still keeps the deletion in its Audit Log) and return the draft to 'approved'
// so it can be fixed and re-posted.
//
// Auth + RLS-scoped read (getDraftForFile) is the authorization. Bumping
// post_attempt on success means a later re-post uses a FRESH idempotency
// requestid instead of re-fetching the now-deleted transaction.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getDraftForFile,
  recordDraftVoided,
  recordDraftPostError,
} from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksDelete, QuickbooksError } from "@/lib/quickbooks/client";
import { effectiveExpenseMode } from "@/lib/quickbooks/draft-resolve";
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
  if (!draft.postReady) {
    return NextResponse.json(
      { error: "not_enabled", detail: "QuickBooks posting isn't enabled yet." },
      { status: 409 },
    );
  }
  if (draft.status !== "posted" || !draft.postedQboId) {
    return NextResponse.json(
      { error: "not_posted", detail: "This draft isn't posted." },
      { status: 409 },
    );
  }

  const ctx = await getQuickbooksReadContext(draft.firmId);
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }

  // Match the entity we posted: income -> Invoice; a PAID expense -> Purchase; an
  // unpaid expense -> Bill. Deleting via the wrong endpoint fails, so this must
  // mirror the branch in post.ts exactly (effectiveExpenseMode).
  const entity =
    draft.suggestion?.direction === "income"
      ? "invoice"
      : draft.suggestion &&
          effectiveExpenseMode(draft.suggestion, draft.resolved) === "purchase"
        ? "purchase"
        : "bill";
  try {
    await quickbooksDelete(
      ctx,
      entity,
      draft.postedQboId,
      draft.postedSyncToken ?? "0",
    );
  } catch (e) {
    const detail =
      e instanceof QuickbooksError ? e.message : (e as Error).message;
    // The draft stays 'posted'; surface the undo error on its card.
    await recordDraftPostError({
      uploadedFileId: fileId,
      error: `Undo failed: ${detail}`,
    });
    revalidate(draft.engagementId);
    return NextResponse.json({ error: "void_failed", detail }, { status: 502 });
  }

  const ok = await recordDraftVoided({
    uploadedFileId: fileId,
    nextAttempt: draft.postAttempt + 1,
  });
  revalidate(draft.engagementId);
  if (!ok) {
    return NextResponse.json(
      {
        error: "record_failed",
        detail: "Voided in QuickBooks but couldn't update the draft. Refresh.",
      },
      { status: 500 },
    );
  }

  try {
    await logUserActivity(draft.firmId, draft.engagementId, "void_qbo_draft", {
      file_id: fileId,
      qbo_id: draft.postedQboId,
    });
  } catch (err) {
    console.error("[qbo void route] audit log failed (void applied):", err);
  }

  return NextResponse.json({ ok: true });
}
