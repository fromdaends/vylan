// Polled by the portal item-card after each upload to surface the AI
// classification verdict without making the upload itself wait for
// Anthropic. The upload route's after() callback runs the classifier
// async; this endpoint just reads the resulting columns. If they haven't
// landed yet, the client keeps polling until either the verdict arrives
// or its own ~30s timeout fires (the cron will pick up any stragglers).
//
// SECURITY: every request validates that the magic token owns the
// engagement that owns the item that owns the file. A guessed file_id or
// item_id from another firm returns 404, same shape as the legit
// "not found" path so we don't leak which IDs exist.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import {
  checkRateLimit,
  PORTAL_STATUS_PER_TOKEN,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

type Usability = {
  usable?: unknown;
  primary_issue?: unknown;
  issue_summary_fr?: unknown;
  issue_summary_en?: unknown;
};

type FileRow = {
  id: string;
  request_item_id: string;
  engagement_id: string;
  ai_classification: string | null;
  ai_rejected: boolean | null;
  ai_usability: Usability | null;
  request_items: {
    id: string;
    status: string;
    rejection_reason: string | null;
  } | {
    id: string;
    status: string;
    rejection_reason: string | null;
  }[] | null;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const itemId = body?.item_id;
  const fileId = body?.file_id;
  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof fileId !== "string"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isValidTokenShape(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rl = await checkRateLimit({
    key: `portal:status:token:${token}`,
    ...PORTAL_STATUS_PER_TOKEN,
  });
  if (!rl.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }

  const sb = getServiceRoleSupabase();

  // Resolve the engagement from the token first — one query, scoped read.
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, magic_expires_at, status")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (engagement.status === "cancelled") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Single query that enforces file → item → engagement ownership. Anything
  // crossing the engagement boundary returns 404.
  const { data: file } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, engagement_id, ai_classification, ai_rejected, ai_usability, request_items!inner(id, status, rejection_reason)",
    )
    .eq("id", fileId)
    .eq("engagement_id", engagement.id)
    .eq("request_item_id", itemId)
    .maybeSingle();
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const f = file as unknown as FileRow;

  // The classification writes ai_classification + ai_usability in the same
  // update. Either non-null means the AI has run.
  const aiComplete =
    f.ai_classification !== null || f.ai_usability !== null;
  if (!aiComplete) {
    return NextResponse.json({ status: "pending" });
  }

  // Mirror the verdict shape the upload route used to return inline. The
  // client treats this exactly like the old response.
  const ri = Array.isArray(f.request_items)
    ? f.request_items[0]
    : f.request_items;
  const rejectionReason = ri?.rejection_reason ?? null;
  // auto_rejected = the router chose auto_reject_and_notify_client. That
  // branch (and only that branch) sets ai_rejected=true + writes a
  // non-empty rejection_reason. Escalations also flip ai_rejected but
  // don't write a reason — those don't show the client banner.
  const autoRejected =
    f.ai_rejected === true &&
    typeof rejectionReason === "string" &&
    rejectionReason.trim() !== "";

  const u = f.ai_usability ?? {};
  const verdict = {
    usable: typeof u.usable === "boolean" ? u.usable : true,
    primary_issue:
      typeof u.primary_issue === "string" ? u.primary_issue : null,
    issue_summary_fr:
      typeof u.issue_summary_fr === "string" ? u.issue_summary_fr : "",
    issue_summary_en:
      typeof u.issue_summary_en === "string" ? u.issue_summary_en : "",
    auto_rejected: autoRejected,
  };

  return NextResponse.json({ status: "done", verdict });
}
