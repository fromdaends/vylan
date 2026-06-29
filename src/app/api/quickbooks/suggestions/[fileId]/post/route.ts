// Post an APPROVED draft to QuickBooks (Stage 5 — the FIRST WRITE) via a STABLE
// URL endpoint. Expenses only (creates a "Bill"); income is deferred. The actual
// post logic lives in postApprovedDraft() (shared with the bulk route); this
// handler just maps its outcome to HTTP + revalidates + audits.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { postApprovedDraft } from "@/lib/quickbooks/post";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

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

  const r = await postApprovedDraft(fileId, auth.user.id);

  // Revalidate when QuickBooks state may have changed (posted) or an error was
  // recorded — never let it hinge on the best-effort audit below.
  if (
    r.engagementId &&
    (r.kind === "posted" ||
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
