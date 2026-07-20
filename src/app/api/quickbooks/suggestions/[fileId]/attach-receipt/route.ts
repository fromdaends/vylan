// Retry attaching the source receipt to an ALREADY-POSTED QuickBooks transaction
// (Stage 5 — receipt-attach). The post path attaches the receipt best-effort right
// after posting; if that missed (unsupported type, a timeout, a storage hiccup, a
// mid-batch route timeout) the draft is already 'posted', so a re-post can't run —
// this stable endpoint re-attaches WITHOUT voiding + re-posting.
//
// Auth + RLS-scoped read (getDraftForFile) is the authorization. Idempotent: a
// draft that's already attached (receipt_attached_at set) returns ok without a
// second upload, so a double click can't create duplicate QuickBooks attachments.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getDraftForFile } from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import {
  effectiveExpenseMode,
  effectiveIncomeMode,
} from "@/lib/quickbooks/draft-resolve";
import { attachReceiptToPostedDraft } from "@/lib/quickbooks/post";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
// Downloads the receipt from storage and uploads it to QuickBooks; give it the
// same headroom as the post route (both are storage-heavy).
export const maxDuration = 60;

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
  // The 0500 column must exist so the attach can be RECORDED — otherwise a retry
  // would upload again on every click (no persisted "attached" flag) and duplicate
  // the attachment in QuickBooks. Mirrors the post/void routes gating on postReady.
  if (!draft.attachReady) {
    return NextResponse.json(
      {
        error: "not_enabled",
        detail: "Receipt-attach tracking isn't enabled yet.",
      },
      { status: 409 },
    );
  }
  if (draft.status !== "posted" || !draft.postedQboId) {
    return NextResponse.json(
      { error: "not_posted", detail: "This draft isn't posted." },
      { status: 409 },
    );
  }
  // Already attached — a no-op success so the UI can refresh into the attached
  // state without a second upload.
  if (draft.receiptAttachedAt) {
    return NextResponse.json({ ok: true, alreadyAttached: true });
  }

  const ctx = await getQuickbooksReadContext(draft.firmId, draft.clientId);
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }

  // Match the entity actually posted. A MATCHED draft (smart posting part 3)
  // points at a transaction that was already in QuickBooks, whose type can
  // DIFFER from what this draft would have created (e.g. the draft says unpaid
  // Bill but the accountant confirmed a match to a paid Expense) — the stored
  // matched type wins. Otherwise: PAID income -> SalesReceipt, unpaid income ->
  // Invoice; a PAID expense -> Purchase, an unpaid expense -> Bill, mirroring
  // the branch in post.ts / the void route exactly (effectiveIncomeMode /
  // effectiveExpenseMode).
  const entity =
    draft.matchedQboType === "bill" ||
    draft.matchedQboType === "purchase" ||
    draft.matchedQboType === "invoice" ||
    draft.matchedQboType === "salesreceipt"
      ? draft.matchedQboType
      : draft.suggestion?.direction === "income"
        ? effectiveIncomeMode(draft.suggestion, draft.resolved) ===
          "salesreceipt"
          ? "salesreceipt"
          : "invoice"
        : draft.suggestion &&
            effectiveExpenseMode(draft.suggestion, draft.resolved) ===
              "purchase"
          ? "purchase"
          : "bill";

  const outcome = await attachReceiptToPostedDraft({
    ctx,
    entity,
    fileId,
    postedQboId: draft.postedQboId,
  });
  revalidate(draft.engagementId);

  if (outcome.kind !== "attached") {
    return NextResponse.json(
      { error: "attach_failed", detail: outcome.detail },
      { status: 502 },
    );
  }

  try {
    await logUserActivity(
      draft.firmId,
      draft.engagementId,
      "attach_qbo_receipt",
      { file_id: fileId, qbo_id: draft.postedQboId },
    );
  } catch (err) {
    console.error(
      "[qbo attach route] audit log failed (attach applied):",
      err,
    );
  }

  return NextResponse.json({ ok: true });
}
