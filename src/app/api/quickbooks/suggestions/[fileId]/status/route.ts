// Approve / dismiss / reopen a QuickBooks DRAFT (Stage 4, Phase 2) via a STABLE
// URL endpoint (deploy-skew-proof, like the resolve / reject / reopen routes),
// NOT a Server Action.
//
// Still READ-ONLY on QuickBooks: this only records the accountant's decision
// (status = approved | dismissed | draft); nothing is posted (that is Stage 5).
//
// Auth + firm scoping: the draft is read under RLS via the authenticated client
// (a row for another firm isn't returned), which IS the authorization. Any firm
// member (staff or owner) may decide a draft — reading + editing these drafts is
// already staff-allowed, so approving is part of the normal workflow.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getDraftForFile, setDraftStatus } from "@/lib/db/quickbooks-suggestions";
import { logUserActivity } from "@/lib/db/activity";
import {
  isDraftStatus,
  canTransitionDraft,
  canApproveDraft,
  type DraftStatus,
} from "@/lib/quickbooks/draft-status";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

// The activity-log action string for each target state (audit trail).
const ACTION: Record<DraftStatus, string> = {
  approved: "approve_qbo_draft",
  dismissed: "dismiss_qbo_draft",
  draft: "reopen_qbo_draft",
};

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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Could not read the request." },
      { status: 400 },
    );
  }
  const target = body.status;
  if (!isDraftStatus(target)) {
    return NextResponse.json(
      { error: "bad_request", detail: "Invalid status." },
      { status: 400 },
    );
  }

  // Authorize (RLS-scoped read) + load the current state for the transition gate.
  const draft = await getDraftForFile(fileId);
  if (!draft) {
    return NextResponse.json(
      { error: "not_found", detail: "Draft not found." },
      { status: 404 },
    );
  }

  // Reject impossible transitions (e.g. approved -> dismissed without reopening,
  // or a stale double-click re-sending the same state).
  if (!canTransitionDraft(draft.status, target)) {
    return NextResponse.json(
      { error: "conflict", detail: "That change is no longer available." },
      { status: 409 },
    );
  }

  // A draft can only be APPROVED when it is complete (server-side guard mirroring
  // the disabled Approve button — never trust the client). A row always carries a
  // suggestion (0430 NOT NULL); guard the null anyway so it can never crash.
  if (
    target === "approved" &&
    (!draft.suggestion || !canApproveDraft(draft.suggestion, draft.resolved))
  ) {
    return NextResponse.json(
      { error: "incomplete", detail: "Finish the draft before approving." },
      { status: 422 },
    );
  }

  const ok = await setDraftStatus({
    uploadedFileId: fileId,
    status: target,
    reviewerId: auth.user.id,
  });
  if (!ok) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  try {
    await logUserActivity(draft.firmId, draft.engagementId, ACTION[target], {
      file_id: fileId,
    });
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${draft.engagementId}`);
    }
  } catch (err) {
    console.error("[qbo status route] post-step failed (status applied):", err);
  }

  return NextResponse.json({ ok: true, status: target });
}
