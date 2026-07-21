// Vercel Cron handler — runs hourly (see vercel.json). Spawns the next
// occurrence of every due recurring series (src/lib/recurring/spawn.ts).
//
// Hourly (not daily) so a firm-local spawn date is honored within the hour
// across timezones; the spawner itself is idempotent (DB-unique occurrence
// ledger), so cadence is a freshness knob, never a correctness one.
//
// Auth model: identical to /api/cron/process-jobs — Vercel injects
// `Authorization: Bearer <CRON_SECRET>` in production (header-only; query
// params leak to logs); the ?secret= fallback exists for dev curl only.

import { NextResponse, type NextRequest } from "next/server";
import { spawnDueRecurrences } from "@/lib/recurring/spawn";

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

  try {
    const summary = await spawnDueRecurrences();
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...summary,
    });
  } catch (e) {
    // A migration-not-applied environment (or a transient DB error) must
    // return a clean 500 the founder can see in Vercel logs — never a crash
    // page. The next hourly run retries naturally.
    console.error("[cron] spawn-recurrences failed:", e);
    return NextResponse.json(
      { error: (e as Error).message ?? String(e) },
      { status: 500 },
    );
  }
}
