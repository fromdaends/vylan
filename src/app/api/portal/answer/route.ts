// The client answering a question about their own books.
//
// Same shape and the same guard rails as mark-na: the magic token is the
// authorization, findItemForToken refuses an expired or closed engagement, and
// every mutation is rate limited per token.
//
// TWO RULES THIS ROUTE ENFORCES THAT THE CARD ALSO HAPPENS TO.
//
//   1. Only a question can be answered. A collection item that arrived here
//      would otherwise get answer text nothing ever reads, and would flip to
//      "submitted" with no file behind it — an engagement that looks answered
//      and has nothing in it.
//
//   2. An answer is written ONCE. By the time a client thinks better of what
//      they wrote, the firm may already have coded the transaction on the
//      strength of it. A silently-changing answer under a booked entry is worse
//      than no answer, so a second attempt is refused and says why rather than
//      overwriting.

import { NextResponse, type NextRequest } from "next/server";
import {
  findItemForToken,
  setItemStatus,
  markEngagementInProgress,
  logActivity,
} from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { checkRateLimit, PORTAL_MUTATION_PER_TOKEN } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Long enough for a client to explain a transaction properly, short enough that
// the field cannot be used to post an essay into the firm's database.
const MAX_ANSWER = 2000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const itemId = body?.item_id;
  const answerRaw = body?.answer;
  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof answerRaw !== "string"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const answer = answerRaw.trim().slice(0, MAX_ANSWER);
  if (!answer) {
    return NextResponse.json({ error: "empty_answer" }, { status: 400 });
  }

  const rl = await checkRateLimit({
    key: `portal:mutation:token:${token}`,
    ...PORTAL_MUTATION_PER_TOKEN,
  });
  if (!rl.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }

  const item = await findItemForToken(token, itemId);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (item.kind !== "question") {
    return NextResponse.json({ error: "not_a_question" }, { status: 400 });
  }
  if (item.answer_text && item.answer_text.trim()) {
    return NextResponse.json({ error: "already_answered" }, { status: 409 });
  }

  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("request_items")
    .update({ answer_text: answer, answered_at: new Date().toISOString() })
    .eq("id", item.id);
  if (error) {
    console.error("[portal answer] write failed:", error);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }

  // The client has done their part; the firm reviews it and codes the entry.
  // Same place in the machinery an uploaded document lands.
  await setItemStatus(item.id, "submitted", item.engagement_id);

  const { data: e } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (e) {
    await markEngagementInProgress(item.engagement_id);
    // The answer itself is NOT copied into the activity log. It lives on the
    // item, next to the transaction it explains; duplicating it into a feed
    // would scatter the one thing the firm needs to find.
    await logActivity(e.firm_id, item.engagement_id, "client_answered_question", {
      item_id: item.id,
    });
  }
  return NextResponse.json({ ok: true });
}
