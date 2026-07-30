import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { checkAiHealth } from "@/lib/ai/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ai-health
//
// Owner-only. "If a client uploaded a document right now, would it get read?"
//
// Born from the 2026-07-30 outage: the OpenAI credit balance hit zero, every
// read failed with "429 You exceeded your current quota", and there was no way
// to find that out except by uploading a document and watching it spin. This
// asks each configured provider directly and reports what it said.
//
// Costs a few tokens per call, so it is deliberately NOT on a timer — it's a
// check you run before a demo, or when something looks wrong.
export async function GET() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  const health = await checkAiHealth();
  // 503 when NOTHING can read — so an uptime monitor pointed here catches the
  // next billing lapse before a client does.
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
