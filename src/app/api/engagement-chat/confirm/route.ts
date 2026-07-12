// POST /api/engagement-chat/confirm — the ONLY path that executes a chat-
// proposed action. The browser posts the pending action's id + its single-
// use token + the human's decision. The model never holds the token and
// cannot reach this endpoint, so "the AI never executes without an explicit
// user confirm" is enforced by architecture, not by prompt.
//
// Flow: auth (+ deactivated guard) → load the pending row (service read
// pinned to the caller's firm) → timing-safe token check → expiry check →
// atomic proposed→confirming claim (two racing confirms: exactly one wins)
// → cancel: resolve; confirm: execute via the SAME lib functions the normal
// buttons use, with the CALLER's RLS session client → resolve row → return
// the card's final state. Confirm/Cancel never touch the chat rate limit
// (no model call, no chat_messages row).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  CHAT_SCHEMA_MISSING,
} from "@/lib/engagement-chat/db";
import {
  claimPendingAction,
  getPendingAction,
  isActionExpired,
  resolvePendingAction,
  tokenMatches,
  transitionFromProposed,
} from "@/lib/engagement-chat/pending-actions";
import { executeAction } from "@/lib/engagement-chat/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  actionId: z.string().uuid(),
  token: z.string().min(10).max(200),
  decision: z.enum(["confirm", "cancel"]),
});

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return jsonError(401, "unauthorized");

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm || user.deactivated_at) {
    return jsonError(401, "unauthorized");
  }

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return jsonError(400, "bad_request");
    body = parsed.data;
  } catch {
    return jsonError(400, "bad_request");
  }

  const row = await getPendingAction(body.actionId, firm.id);
  if (row === CHAT_SCHEMA_MISSING) return jsonError(503, "chat_not_ready");
  if (!row) return jsonError(404, "not_found");
  if (!tokenMatches(row.token, body.token)) return jsonError(403, "bad_token");

  // Already resolved (double click, teammate got there first, old tab).
  if (row.status !== "proposed") {
    return NextResponse.json({
      status: row.status,
      error: row.error,
    });
  }

  if (isActionExpired(row, Date.now())) {
    // CAS: if a confirm slipped in first, report ITS outcome, not "expired".
    const won = await transitionFromProposed(row.id, firm.id, "expired");
    if (won) return NextResponse.json({ status: "expired", error: null });
    const latest = await getPendingAction(row.id, firm.id);
    return NextResponse.json({
      status: latest && latest !== CHAT_SCHEMA_MISSING ? latest.status : "failed",
      error: latest && latest !== CHAT_SCHEMA_MISSING ? latest.error : null,
    });
  }

  if (body.decision === "cancel") {
    // CAS so a Cancel can't overwrite a confirm/expire that landed first.
    const won = await transitionFromProposed(row.id, firm.id, "cancelled");
    if (won) return NextResponse.json({ status: "cancelled", error: null });
    const latest = await getPendingAction(row.id, firm.id);
    return NextResponse.json({
      status: latest && latest !== CHAT_SCHEMA_MISSING ? latest.status : "failed",
      error: latest && latest !== CHAT_SCHEMA_MISSING ? latest.error : null,
    });
  }

  // Confirm: claim atomically so two simultaneous confirms execute once.
  const claimed = await claimPendingAction(row.id, firm.id);
  if (!claimed) {
    const latest = await getPendingAction(row.id, firm.id);
    return NextResponse.json({
      status:
        latest !== CHAT_SCHEMA_MISSING && latest ? latest.status : "failed",
      error:
        latest !== CHAT_SCHEMA_MISSING && latest ? latest.error : null,
    });
  }

  const result = await executeAction(row.action_type, row.payload, {
    sb: supabase,
    userId: user.id,
    firmId: firm.id,
    engagementId: row.engagement_id,
  });

  if (!result.ok) {
    await resolvePendingAction(row.id, firm.id, {
      status: "failed",
      confirmedBy: user.id,
      error: result.code,
    });
    return NextResponse.json({ status: "failed", error: result.code });
  }

  await resolvePendingAction(row.id, firm.id, {
    status: "confirmed",
    confirmedBy: user.id,
  });
  return NextResponse.json({ status: "confirmed", error: null });
}
