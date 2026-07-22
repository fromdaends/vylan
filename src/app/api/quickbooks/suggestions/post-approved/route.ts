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
import {
  getQuickbooksReadContext,
  type QuickbooksReadContext,
} from "@/lib/quickbooks/connection";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
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
      // 0790: posting is QuickBooks-only in Phase 3. A Xero draft would resolve a
      // null QuickBooks context and merely be skipped, but exclude it up front so
      // it never inflates the skipped count or wastes a context resolution.
      r.provider !== "xero" &&
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

  // Resolve the firm once (RLS owns the targets). The connection context + cached
  // lists are PER CLIENT (0710): a batch can span multiple clients, each with its
  // OWN QuickBooks company, so we resolve + memoize them per client id and reuse
  // within that client's runs — nothing firm-level is fetched up front.
  const firmId = (await getCurrentUser())?.firm_id ?? null;

  type ClientCtx = { ctx: QuickbooksReadContext; lists: QuickbooksLists | null };
  const byClient = new Map<string, ClientCtx | null>();
  // Lazily resolve (and cache) a client's context+lists. A client with no
  // connection → null (its drafts skip). A client revoked mid-run is marked null
  // so its remaining drafts skip without re-hitting QuickBooks.
  async function resolveClient(
    clientId: string | null,
  ): Promise<ClientCtx | null> {
    const key = clientId ?? "";
    if (byClient.has(key)) return byClient.get(key) ?? null;
    const ctx = firmId
      ? await getQuickbooksReadContext(firmId, clientId)
      : null;
    const resolved: ClientCtx | null = ctx
      ? { ctx, lists: await readCachedQuickbooksLists(clientId) }
      : null;
    byClient.set(key, resolved);
    return resolved;
  }

  let posted = 0;
  let failed = 0;
  let skipped = 0;
  // Smart posting part 3: drafts that LOOK like they're already in QuickBooks
  // but need the accountant's eyes. A bulk run never decides an uncertain match
  // — these are left untouched and surfaced so each card gets opened.
  let needsReview = 0;
  const engagementIds = new Set<string>();
  for (const t of targets) {
    const resolved = await resolveClient(t.clientId);
    if (!resolved) {
      // This client's QuickBooks isn't connected (or was revoked mid-run) — skip.
      skipped++;
      continue;
    }
    let out: PostOutcome;
    try {
      out = await postApprovedDraft(t.fileId, auth.user.id, {
        lists: resolved.lists,
        ctx: resolved.ctx,
      });
    } catch {
      failed++;
      continue;
    }
    if (out.engagementId) engagementIds.add(out.engagementId);
    if (out.kind === "reconnect_required") {
      // THIS client's grant was revoked — every remaining draft for this client
      // would 401 too. Mark it dead so they skip; OTHER clients still post.
      byClient.set(t.clientId ?? "", null);
      failed++;
      continue;
    }
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
