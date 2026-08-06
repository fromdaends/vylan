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

  // ── TWO INDEPENDENT DRAINS, NEITHER ABLE TO KILL THE OTHER ───────────────
  //
  // This route runs two unrelated scheduled things: spawning the next occurrence
  // of a repeating engagement, and raising the next period's invoice for an
  // ongoing billing arrangement (1710).
  //
  // They MUST be isolated from each other, and the first version of this shipped
  // with them nested — spawn ran inside the outer try, so a spawn throw jumped
  // straight past the billing drain and skipped every recurring invoice for that
  // hour. The comment beside it claimed that could not happen. It could, and a
  // comment is not a guard. Each now has its own try/catch and the route only
  // fails if BOTH fail.
  const out: Record<string, unknown> = { ranAt: new Date().toISOString() };
  let spawnFailed: unknown = null;
  let billingFailed: unknown = null;

  try {
    Object.assign(out, await spawnDueRecurrences());
  } catch (e) {
    console.error("[cron] spawn-recurrences failed:", e);
    spawnFailed = e;
    out.spawn = { error: (e as Error)?.message ?? String(e) };
  }

  try {
    const billing = await drainDueRecurringCharges();
    out.billing = { checked: billing.checked, charged: billing.charged };
  } catch (e) {
    console.error("[cron] recurring charges drain failed:", e);
    billingFailed = e;
    out.billing = { error: (e as Error)?.message ?? String(e) };
  }

  // Only a total failure is a 500 — a half-run did real work and its result has
  // to reach the logs, not be swallowed by an error status. A partial failure is
  // still visible: the failed half carries an `error` key in the body.
  if (spawnFailed && billingFailed) {
    return NextResponse.json(out, { status: 500 });
  }
  return NextResponse.json(out);
}
