// GET /api/engagement-chat/history?engagementId=… — the Assistant panel's
// chat bootstrap: the persisted conversation for the engagement plus the
// caller's rolling-window limit state. Returns { ready: false } before
// migration 0550 is applied so the panel can show its "not activated yet"
// note instead of erroring.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import {
  CHAT_HISTORY_FETCH_LIMIT,
  CHAT_WINDOW_HOURS,
} from "@/lib/engagement-chat/config";
import { computeChatLimitState } from "@/lib/engagement-chat/limit";
import {
  CHAT_SCHEMA_MISSING,
  getConversationId,
  listChatMessages,
  listUserTurnTimes,
} from "@/lib/engagement-chat/db";
import { listConversationActions } from "@/lib/engagement-chat/pending-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Client-polled route → must enforce the deactivated flag itself (the app
  // layout's force-logout never runs for fetch() calls).
  const user = await getCurrentUser();
  if (!user || user.deactivated_at) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const engagementId = new URL(req.url).searchParams.get("engagementId");
  if (!engagementId || !UUID_RE.test(engagementId)) {
    return NextResponse.json({ error: "invalid_engagement" }, { status: 400 });
  }

  // RLS existence check — 404 for other-firm/bogus ids.
  const { data: engagement, error: engagementError } = await supabase
    .from("engagements")
    .select("id")
    .eq("id", engagementId)
    .maybeSingle();
  if (engagementError) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const nowMs = Date.now();
    const sinceIso = new Date(
      nowMs - CHAT_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const [conversationId, turnTimes] = await Promise.all([
      getConversationId(supabase, user.firm_id, engagementId, {
        create: false,
      }),
      listUserTurnTimes(supabase, user.id, sinceIso),
    ]);
    if (
      conversationId === CHAT_SCHEMA_MISSING ||
      turnTimes === CHAT_SCHEMA_MISSING
    ) {
      return NextResponse.json({ ready: false });
    }

    const limitState = computeChatLimitState(turnTimes, nowMs);

    if (conversationId === null) {
      return NextResponse.json({
        ready: true,
        messages: [],
        actions: [],
        limit: limitState.limit,
        remaining: limitState.remaining,
        resetAt: limitState.resetAt,
      });
    }

    const [rows, actions] = await Promise.all([
      listChatMessages(supabase, conversationId, CHAT_HISTORY_FETCH_LIMIT),
      // Confirm cards, with the confirm token attached ONLY to still-live
      // proposed cards. Service-role read pinned to the conversation +
      // firm we just RLS-verified — the token column has no authenticated
      // grant, so this is the only way a reloaded panel can still confirm.
      listConversationActions(conversationId, user.firm_id, nowMs),
    ]);
    if (rows === CHAT_SCHEMA_MISSING) {
      return NextResponse.json({ ready: false });
    }

    return NextResponse.json({
      ready: true,
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
      // Pre-0560 (actions table not applied yet): no cards, chat still works.
      actions: actions === CHAT_SCHEMA_MISSING ? [] : actions,
      limit: limitState.limit,
      remaining: limitState.remaining,
      resetAt: limitState.resetAt,
    });
  } catch (err) {
    console.error("[engagement-chat] history failed:", err);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
