// Bulk-post every APPROVED expense draft to QuickBooks (Stage 5, Phase 2) via a
// STABLE URL endpoint, optionally scoped to one client. Reuses postApprovedDraft
// per draft (same gates + idempotency as the single route), processed
// SEQUENTIALLY to stay well under QuickBooks' per-company rate limit. The
// connection context + cached lists are fetched ONCE and reused.
//
// Each draft is independent: one failure doesn't abort the batch (its error is
// recorded on that draft and reported back). Still safe — the per-draft schema
// gate + idempotency guarantee no double-post.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { listFirmDrafts } from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { postApprovedDraft, type PostOutcome } from "@/lib/quickbooks/post";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
// A batch posts sequentially and each post now also downloads the receipt and
// uploads it to QuickBooks, so give the function the same headroom the other
// storage-heavy routes use (process-jobs, zip exports) instead of the short
// platform default.
export const maxDuration = 60;

const LOCALES = ["en", "fr"] as const;

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const client =
    typeof body.client === "string" && body.client ? body.client : null;

  // Recompute the set to post from RLS-scoped data (never trust the client):
  // approved EXPENSE drafts (optionally for one client). Income/incomplete drafts
  // are left for postApprovedDraft to skip.
  const rows = await listFirmDrafts();
  const targets = rows.filter(
    (r) =>
      r.status === "approved" &&
      (r.suggestion.direction === "expense" ||
        r.suggestion.direction === "income") &&
      !r.postedQboId &&
      (!client || r.clientId === client),
  );

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      posted: 0,
      failed: 0,
      skipped: 0,
      needsReview: 0,
    });
  }

  // Fetch the connection context + cached lists ONCE for the whole batch. The
  // caller's firm (RLS-scoped) owns every target row.
  const firmId = (await getCurrentUser())?.firm_id ?? null;
  const ctx = firmId ? await getQuickbooksReadContext(firmId) : null;
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }
  const lists = await readCachedQuickbooksLists();

  let posted = 0;
  let failed = 0;
  let skipped = 0;
  // Smart posting part 3: drafts that LOOK like they're already in QuickBooks
  // but need the accountant's eyes. A bulk run never decides an uncertain match
  // — these are left untouched and surfaced so each card gets opened.
  let needsReview = 0;
  const engagementIds = new Set<string>();
  for (const t of targets) {
    let out: PostOutcome;
    try {
      out = await postApprovedDraft(t.fileId, auth.user.id, { lists, ctx });
    } catch {
      failed++;
      continue;
    }
    if (out.engagementId) engagementIds.add(out.engagementId);
    if (
      out.kind === "posted" ||
      out.kind === "already_posted" ||
      // Matched-to-existing counts as success: the receipt is on the books
      // (attached to the transaction that was already there).
      out.kind === "matched_existing"
    )
      posted++;
    // 'conflict' + 'record_failed' both mean "posted to QuickBooks but couldn't
    // record it locally" — a real problem that needs attention, NOT a benign skip.
    else if (
      out.kind === "post_failed" ||
      out.kind === "record_failed" ||
      out.kind === "conflict"
    )
      failed++;
    else if (out.kind === "needs_match_confirmation") needsReview++;
    else skipped++; // not_postable / not_connected / not_approved
  }

  // Bust the cache for the queue + each touched engagement (both locales).
  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/quickbooks/drafts`);
    for (const eid of engagementIds) {
      revalidatePath(`/${loc}/engagements/${eid}`);
    }
  }

  try {
    if (firmId) {
      await logUserActivity(firmId, null, "bulk_post_qbo_drafts", {
        posted,
        failed,
        skipped,
        needs_review: needsReview,
        client,
      });
    }
  } catch (err) {
    console.error("[qbo post-approved] audit log failed (posts applied):", err);
  }

  return NextResponse.json({ ok: true, posted, failed, skipped, needsReview });
}
