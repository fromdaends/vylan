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
import {
  effectiveExpenseMode,
  effectiveIncomeMode,
} from "@/lib/quickbooks/draft-resolve";
import { logUserActivity } from "@/lib/db/activity";
import { isClientXeroConnected } from "@/lib/db/xero";
import { undoXeroPost } from "@/lib/xero/post";

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

  // Xero-connected client → undo in Xero (delete the BankTransaction / void the
  // ACCPAY invoice), then fall through the SAME response contract the client
  // expects. QuickBooks drafts continue below unchanged.
  if (
    draft.clientId &&
    draft.firmId &&
    (await isClientXeroConnected(draft.firmId, draft.clientId))
  ) {
    const r = await undoXeroPost(fileId);
    switch (r.kind) {
      case "not_found":
        return NextResponse.json(
          { error: "not_found", detail: "Draft not found." },
          { status: 404 },
        );
      case "not_enabled":
        return NextResponse.json(
          { error: "not_enabled", detail: "Xero posting isn't enabled yet." },
          { status: 409 },
        );
      case "not_posted":
        return NextResponse.json(
          { error: "not_posted", detail: "This draft isn't posted." },
          { status: 409 },
        );
      case "not_connected":
        return NextResponse.json(
          { error: "not_connected", detail: "Xero isn't connected." },
          { status: 409 },
        );
      case "void_failed":
        revalidate(r.engagementId);
        return NextResponse.json(
          { error: "void_failed", detail: r.detail },
          { status: 502 },
        );
      case "record_failed":
        revalidate(r.engagementId);
        return NextResponse.json(
          {
            error: "record_failed",
            detail: "Voided in Xero but couldn't update the draft. Refresh.",
          },
          { status: 500 },
        );
      case "ok":
        revalidate(r.engagementId);
        try {
          await logUserActivity(r.firmId, r.engagementId, "void_qbo_draft", {
            file_id: fileId,
            qbo_id: r.postedXeroId,
          });
        } catch (err) {
          console.error("[xero void route] audit log failed (void applied):", err);
        }
        return NextResponse.json({ ok: true });
    }
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

  const ctx = await getQuickbooksReadContext(draft.firmId, draft.clientId);
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }

  // Smart posting part 3: a MATCHED draft points at a transaction that was
  // ALREADY in QuickBooks (Vylan never created it), so undo must NOT delete it
  // — it only UNLINKS on our side (the draft returns to Approved; the
  // transaction, and any receipt already attached to it in QuickBooks, stays).
  const matched = draft.matchedQboType != null;
  if (!matched) {
    // Match the entity we posted: PAID income -> SalesReceipt, unpaid income ->
    // Invoice; a PAID expense -> Purchase, an unpaid expense -> Bill. Deleting
    // via the wrong endpoint fails, so this must mirror the branch in post.ts
    // exactly (effectiveIncomeMode / effectiveExpenseMode).
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
      return NextResponse.json(
        { error: "void_failed", detail },
        { status: 502 },
      );
    }
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
      // Distinguish "deleted Vylan's transaction" from "unlinked a matched one
      // (nothing deleted in QuickBooks)" in the activity feed.
      unlinked_match: matched || undefined,
    });
  } catch (err) {
    console.error("[qbo void route] audit log failed (void applied):", err);
  }

  return NextResponse.json({ ok: true });
}
