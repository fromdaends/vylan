// Post an APPROVED draft to QuickBooks (Stage 5, Phase 1 — the FIRST WRITE) via
// a STABLE URL endpoint. Expenses only (creates a "Bill"); income is deferred.
//
// Safety (in order):
//  - auth + RLS-scoped read (getDraftForFile) = the authorization.
//  - schema gate: refuse to call QuickBooks unless the 0450 columns exist, so a
//    successful post can ALWAYS be recorded (no post-without-record window).
//  - idempotency: if already posted, return success without re-posting; and the
//    QuickBooks requestid is `${fileId}-${attempt}`, so a retried/raced POST
//    returns the ORIGINAL transaction instead of creating a duplicate.
//  - re-validate the (effective) vendor/account are still active right now.
//  - on QuickBooks error the draft stays 'approved' with post_error set (retry).

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getDraftForFile,
  recordDraftPosted,
  recordDraftPostError,
} from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksCreate, QuickbooksError } from "@/lib/quickbooks/client";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { effectiveMapping } from "@/lib/quickbooks/draft-resolve";
import {
  buildBillPayload,
  checkBillPostable,
} from "@/lib/quickbooks/post-transaction";
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
  if (!draft || !draft.suggestion) {
    return NextResponse.json(
      { error: "not_found", detail: "Draft not found." },
      { status: 404 },
    );
  }

  // Schema gate: never write to QuickBooks if we can't record the result.
  if (!draft.postReady) {
    return NextResponse.json(
      { error: "not_enabled", detail: "QuickBooks posting isn't enabled yet." },
      { status: 409 },
    );
  }

  // Already posted → idempotent success (no second transaction).
  if (draft.status === "posted" || draft.postedQboId) {
    return NextResponse.json({
      ok: true,
      alreadyPosted: true,
      postedQboId: draft.postedQboId,
    });
  }

  if (draft.status !== "approved") {
    return NextResponse.json(
      { error: "conflict", detail: "Only an approved draft can be posted." },
      { status: 409 },
    );
  }

  const s = draft.suggestion;
  const eff = effectiveMapping(s, draft.resolved);

  // Re-validate against the firm's CURRENT lists (a vendor/account could have
  // been archived since approval). Expenses only.
  const lists = await readCachedQuickbooksLists();
  const problems = checkBillPostable({
    direction: s.direction,
    party: eff.party,
    account: eff.account,
    amount: s.amount,
    lists,
  });
  if (problems.length > 0 || !eff.party || !eff.account || s.amount == null) {
    return NextResponse.json(
      { error: "not_postable", problems },
      { status: 422 },
    );
  }

  const ctx = await getQuickbooksReadContext(draft.firmId);
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }

  const requestId = `${fileId}-${draft.postAttempt}`;
  const payload = buildBillPayload({
    vendorId: eff.party.id,
    accountId: eff.account.id,
    amount: s.amount,
    date: s.date,
    memo: "Posted from Vylan",
  });

  let result: { id: string; syncToken: string };
  try {
    result = await quickbooksCreate(ctx, "bill", payload, requestId);
  } catch (e) {
    const detail =
      e instanceof QuickbooksError ? e.message : (e as Error).message;
    await recordDraftPostError({ uploadedFileId: fileId, error: detail });
    revalidate(draft.engagementId);
    return NextResponse.json({ error: "post_failed", detail }, { status: 502 });
  }

  const recorded = await recordDraftPosted({
    uploadedFileId: fileId,
    expectedAttempt: draft.postAttempt,
    postedQboId: result.id,
    postedSyncToken: result.syncToken,
    posterId: auth.user.id,
  });
  revalidate(draft.engagementId);
  if (recorded === "conflict") {
    // The draft changed while we were posting (a concurrent reopen or undo). We
    // did NOT record — so we never mark a voided transaction as posted, nor make
    // an illegal -> 'posted' transition. The stable requestid means the genuine
    // retry re-finds the same QuickBooks transaction (no duplicate).
    return NextResponse.json(
      {
        error: "conflict",
        detail:
          "This draft changed while posting. Refresh and check QuickBooks before retrying.",
      },
      { status: 409 },
    );
  }
  if (recorded !== "ok") {
    // Posted in QuickBooks but the DB write failed. The stable requestid means a
    // retry will NOT double-post (QBO returns this same transaction), so surface
    // loudly and let the accountant retry.
    return NextResponse.json(
      {
        error: "record_failed",
        detail: "Posted to QuickBooks but couldn't save it. Refresh and retry.",
        postedQboId: result.id,
      },
      { status: 500 },
    );
  }

  try {
    await logUserActivity(draft.firmId, draft.engagementId, "post_qbo_draft", {
      file_id: fileId,
      qbo_id: result.id,
    });
  } catch (err) {
    console.error("[qbo post route] audit log failed (post applied):", err);
  }

  return NextResponse.json({ ok: true, postedQboId: result.id });
}
