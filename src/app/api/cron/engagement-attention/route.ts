// Vercel Cron handler — the daily engagement-attention sweep.
//
// Raises engagement.due_soon / engagement.overdue / engagement.stalled, the
// three catalog events that describe a STATE rather than a moment and so have
// nothing to hang off. See src/lib/notifications/attention-sweep.ts for why
// re-running is safe (the catalog bundles all three inside a 24h window, so
// firing more often cannot produce more than one notification per engagement
// per day).
//
// ⚠️ NOT YET SCHEDULED. vercel.json is a shared config file, so per the repo
// rules this needs the founder's go-ahead before the entry is added:
//
//   { "path": "/api/cron/engagement-attention", "schedule": "0 5 * * *" }
//
// Until that line exists this route is inert and those three events never
// fire — which is exactly the state they are in today, so nothing regresses in
// the meantime. 05:00 UTC is deliberately an hour after the existing
// purge-deleted-engagements cron so the two never contend.
//
// Auth model: identical to the other crons — Vercel injects
// `Authorization: Bearer <CRON_SECRET>` in production (header-only; query
// params leak to logs); the ?secret= fallback exists for dev curl only.

import { NextResponse, type NextRequest } from "next/server";
import { sweepEngagementAttention } from "@/lib/notifications/attention-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && expected.trim() !== "") {
    const authHeader = request.headers.get("authorization") ?? "";
    let ok = authHeader === `Bearer ${expected}`;
    if (!ok && process.env.NODE_ENV !== "production") {
      const queryToken = new URL(request.url).searchParams.get("secret") ?? "";
      ok = queryToken === expected;
    }
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await sweepEngagementAttention();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
