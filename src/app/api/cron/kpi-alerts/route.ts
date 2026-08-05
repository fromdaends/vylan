// Vercel Cron handler — the daily KPI alert sweep (1690).
//
// Founder: "built the bell alert thing". Canopy offers hourly / daily / weekly
// / monthly checks; this route runs DAILY and the rule's own frequency is used
// as a cooldown on top. So an hourly alert is checked once a day today rather
// than silently pretending — the honest gap, written down here and visible in
// vercel.json, which is the source of truth for cron state (a handler comment
// claiming otherwise has been believed over the config before in this repo).
//
// SCHEDULED: vercel.json runs this at "0 6 * * *" — an hour after
// engagement-attention (05:00) so the two never contend.
//
// Auth model: identical to the other crons — Vercel injects
// `Authorization: Bearer <CRON_SECRET>` in production (header-only; query
// params leak to logs); the ?secret= fallback exists for dev curl only.

import { NextResponse, type NextRequest } from "next/server";
import { runKpiAlerts } from "@/lib/dashboard/run-kpi-alerts";

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

  const result = await runKpiAlerts();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
