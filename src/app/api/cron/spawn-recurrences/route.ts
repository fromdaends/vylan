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
import { drainDueRecurringCharges } from "@/lib/billing/drain-recurring";

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

    // The OTHER kind of scheduled recurring thing (1710): a "$400/month" line
    // on an accepted proposal raises one real invoice per period. It rides this
    // cron rather than its own because "the scheduled things that should have
    // happened by now, happen" is already what this route means — and because
    // two crons would be two answers to where scheduled charges live.
    //
    // Its own try//catch: a billing hiccup must never stop engagements from
    // spawning, and a spawn failure must never stop the billing.
    let billing: Awaited<ReturnType<typeof drainDueRecurringCharges>> | null =
      null;
    try {
      billing = await drainDueRecurringCharges();
    } catch (e) {
      console.error("[cron] recurring charges drain failed:", e);
    }

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...summary,
      billing: billing
        ? { checked: billing.checked, charged: billing.charged }
        : { error: "drain_failed" },
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
