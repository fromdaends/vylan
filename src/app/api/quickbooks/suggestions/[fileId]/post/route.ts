// Post an APPROVED draft to QuickBooks (Stage 5 — the FIRST WRITE) via a STABLE
// URL endpoint. Expenses only (creates a "Bill"); income is deferred. The actual
// post logic lives in postApprovedDraft() (shared with the bulk route); this
// handler just maps its outcome to HTTP + revalidates + audits.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  postApprovedDraft,
  type PostMatchOverride,
} from "@/lib/quickbooks/post";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
// The post now also downloads the receipt and uploads it to QuickBooks; give it
// headroom over the short platform default (matches the storage-heavy routes).
export const maxDuration = 60;

const LOCALES = ["en", "fr"] as const;

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

  // Smart posting part 3: the body may carry the accountant's answer to a
  // prior "already in QuickBooks?" prompt — attach to a specific existing
  // transaction, or force a create. Anything malformed is ignored (normal
  // match-or-create behavior).
  let match: PostMatchOverride | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.matchAction === "create") {
      match = { action: "create" };
    } else if (
      body.matchAction === "attach" &&
      typeof body.attachQboId === "string" &&
      body.attachQboId
    ) {
      // attachEntity pins the pick to the chosen transaction TYPE (Bill/Purchase/
      // Invoice) — QBO ids are unique only per type. Optional: a stale client may
      // omit it, and postApprovedDraft then falls back to id-only matching.
      const e = body.attachEntity;
      const entity =
        e === "bill" || e === "purchase" || e === "invoice" ? e : undefined;
      match = { action: "attach", qboId: body.attachQboId, entity };
    }
  } catch {
    match = undefined;
  }

  const r = await postApprovedDraft(fileId, auth.user.id, { match });

  // Revalidate when QuickBooks state may have changed (posted) or an error was
  // recorded — never let it hinge on the best-effort audit below.
  if (
    r.engagementId &&
    (r.kind === "posted" ||
      r.kind === "matched_existing" ||
      r.kind === "post_failed" ||
      r.kind === "conflict" ||
      r.kind === "record_failed")
  ) {
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/quickbooks/drafts`);
      revalidatePath(`/${loc}/engagements/${r.engagementId}`);
    }
  }

  switch (r.kind) {
    case "posted":
      try {
        if (r.firmId) {
          await logUserActivity(r.firmId, r.engagementId, "post_qbo_draft", {
            file_id: fileId,
            qbo_id: r.postedQboId,
          });
        }
      } catch (err) {
        console.error("[qbo post route] audit log failed (post applied):", err);
      }
      return NextResponse.json({ ok: true, postedQboId: r.postedQboId });
    case "matched_existing":
      // Nothing was created: the receipt was attached to a transaction that was
      // ALREADY in QuickBooks. Same audit action with a matched flag so the
      // activity feed tells the two apart.
      try {
        if (r.firmId) {
          await logUserActivity(r.firmId, r.engagementId, "post_qbo_draft", {
            file_id: fileId,
            qbo_id: r.postedQboId,
            matched_existing: true,
          });
        }
      } catch (err) {
        console.error("[qbo post route] audit log failed (match applied):", err);
      }
      return NextResponse.json({
        ok: true,
        matched: true,
        postedQboId: r.postedQboId,
      });
    case "needs_match_confirmation":
      // Nothing was written — the accountant must choose. 409 (not an error
      // state, but not a success either) with the candidates for the dialog.
      return NextResponse.json(
        {
          error: "needs_match_confirmation",
          candidates: (r.matchCandidates ?? []).map((c) => ({
            qboId: c.qboId,
            entity: c.entity,
            txnDate: c.txnDate,
            totalAmt: c.totalAmt,
            docNumber: c.docNumber,
            vendorName: c.vendorName,
            // Sent so a multicurrency candidate shows its code next to the
            // amount (a USD 100.00 vs the draft's CAD $100.00). null in a
            // single-currency company.
            currency: c.currency,
          })),
        },
        { status: 409 },
      );
    case "already_posted":
      return NextResponse.json({
        ok: true,
        alreadyPosted: true,
        postedQboId: r.postedQboId,
      });
    case "not_found":
      return NextResponse.json(
        { error: "not_found", detail: "Draft not found." },
        { status: 404 },
      );
    case "not_enabled":
      return NextResponse.json(
        { error: "not_enabled", detail: "QuickBooks posting isn't enabled yet." },
        { status: 409 },
      );
    case "not_approved":
      return NextResponse.json(
        { error: "conflict", detail: "Only an approved draft can be posted." },
        { status: 409 },
      );
    case "not_postable":
      return NextResponse.json(
        { error: "not_postable", problems: r.problems },
        { status: 422 },
      );
    case "not_connected":
      return NextResponse.json(
        { error: "not_connected", detail: "QuickBooks isn't connected." },
        { status: 409 },
      );
    case "post_failed":
      return NextResponse.json(
        { error: "post_failed", detail: r.detail },
        { status: 502 },
      );
    case "conflict":
      return NextResponse.json(
        {
          error: "conflict",
          detail:
            "This draft changed while posting. Refresh and check QuickBooks before retrying.",
        },
        { status: 409 },
      );
    case "record_failed":
      return NextResponse.json(
        {
          error: "record_failed",
          detail: "Posted to QuickBooks but couldn't save it. Refresh and retry.",
          postedQboId: r.postedQboId,
        },
        { status: 500 },
      );
  }
}
