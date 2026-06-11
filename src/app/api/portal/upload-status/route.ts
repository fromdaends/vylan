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
  confidence?: unknown;
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
  ai_extracted_fields: Record<string, unknown> | null;
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

// shouldActOnUsability threshold, duplicated here so the poll endpoint
// doesn't pull in the AI subtree. If you change USABILITY_CONFIDENCE_THRESHOLD
// in src/lib/ai/usability.ts, change this too.
const USABILITY_CONFIDENCE_THRESHOLD = 0.8;

// Pure decision: has the AI verdict fully settled, or should the client keep
// polling? Exported for tests. "Settled" needs two things:
//   1. The classifier actually ran (wrote a classification or usability) — OR
//      the file is already terminally rejected. The ai_rejected escape hatch
//      matters because a MALFORMED AI read can leave ai_classification AND
//      ai_usability null while the router still flips ai_rejected=true; without
//      it the client would poll for the full 10 minutes and never resolve.
//   2. The router won't still add an auto-reject banner we'd miss. The router
//      only writes (ai_rejected + reason) when the doc is unusable + confident
//      + the firm has auto-reject on; in that one combination we wait until
//      ai_rejected lands so the banner isn't missed by a reload-less client.
// Positive confirmation: the AI affirmatively judged this upload to be the
// requested document. Drives the client's green "received — looks right"
// note. Deliberately conservative: it needs an explicit looks_correct=true
// read off the document (a missing or garbled read confirms nothing), a
// usable document, and no auto-reject. Exported for tests.
export function isConfirmedVerdict(f: {
  ai_extracted_fields: Record<string, unknown> | null;
  ai_usability: { usable?: unknown } | null;
  ai_rejected: boolean | null;
}): boolean {
  if (f.ai_rejected === true) return false;
  if ((f.ai_usability ?? {}).usable === false) return false;
  return (f.ai_extracted_fields ?? {}).looks_correct === true;
}

export function isVerdictSettled(
  f: {
    ai_classification: string | null;
    ai_usability: { usable?: unknown; confidence?: unknown } | null;
    ai_rejected: boolean | null;
  },
  firmAutoRejectOn: boolean,
): boolean {
  const u = f.ai_usability ?? {};
  const usable = u.usable !== false; // true or unknown → treat as usable
  const confident =
    typeof u.confidence === "number" &&
    u.confidence >= USABILITY_CONFIDENCE_THRESHOLD;
  const routerWillSkipWrites = usable || !confident || !firmAutoRejectOn;
  const aiRan =
    f.ai_classification !== null ||
    f.ai_usability !== null ||
    f.ai_rejected === true;
  const routerStillPending = !routerWillSkipWrites && f.ai_rejected !== true;
  return aiRan && !routerStillPending;
}

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

  // Resolve the engagement + the firm's auto-reject setting in one round
  // trip. The firm flag is needed to decide whether the router will write
  // anything we should still wait for (see "done" logic below).
  const { data: engagement } = await sb
    .from("engagements")
    .select(
      "id, magic_expires_at, status, firm_id, firms!inner(auto_reject_unusable_docs)",
    )
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
  type FirmEmbed = { auto_reject_unusable_docs: boolean | null };
  const firmsEmbed = (engagement as { firms?: FirmEmbed | FirmEmbed[] }).firms;
  const firmRow = Array.isArray(firmsEmbed) ? firmsEmbed[0] : firmsEmbed;
  const firmAutoRejectOn = firmRow?.auto_reject_unusable_docs === true;

  // Single query that enforces file → item → engagement ownership. Anything
  // crossing the engagement boundary returns 404.
  const { data: file } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, engagement_id, ai_classification, ai_rejected, ai_usability, ai_extracted_fields, request_items!inner(id, status, rejection_reason)",
    )
    .eq("id", fileId)
    .eq("engagement_id", engagement.id)
    .eq("request_item_id", itemId)
    .maybeSingle();
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const f = file as unknown as FileRow;

  // "Done" needs more than just "the classifier ran". The router runs in a
  // separate set of writes ~10-200ms after the classification write — if the
  // poll fires inside that gap and we declare done, the client misses the
  // auto-reject banner and only sees it on the next page reload (the bug
  // the user hit on the first ship of this feature).
  //
  // So "done" = classifier ran AND we're sure the router won't add anything
  // we care about. The router DOES write (ai_rejected, rejection_reason)
  // only when:  AI says unusable + confidence >= 0.80 + firm has
  // auto_reject_unusable_docs = true. Anything else either skips the router
  // entirely or runs queue_for_accountant which writes nothing visible to
  // the client. So we keep polling only in that one specific combination.
  const u = f.ai_usability ?? {};
  if (!isVerdictSettled(f, firmAutoRejectOn)) {
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

  const verdict = {
    usable: typeof u.usable === "boolean" ? u.usable : true,
    primary_issue:
      typeof u.primary_issue === "string" ? u.primary_issue : null,
    issue_summary_fr:
      typeof u.issue_summary_fr === "string" ? u.issue_summary_fr : "",
    issue_summary_en:
      typeof u.issue_summary_en === "string" ? u.issue_summary_en : "",
    auto_rejected: autoRejected,
    // The green "received — looks like the right document" note. Never true
    // together with auto_rejected (a rejected file fails isConfirmedVerdict).
    confirmed: !autoRejected && isConfirmedVerdict(f),
  };

  return NextResponse.json({ status: "done", verdict });
}
