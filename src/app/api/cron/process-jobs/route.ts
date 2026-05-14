// Vercel Cron handler — runs every 15 minutes (see vercel.json).
//
// Auth model:
//   * In production: Vercel injects `Authorization: Bearer <CRON_SECRET>` from
//     the env var of the same name. Header-only — never accept the secret via
//     query string, as URL params leak to logs/Referer.
//   * In dev (NODE_ENV !== "production"): the ?secret= fallback is allowed
//     so `curl localhost:3000/api/cron/...` works without forging headers.

import { NextResponse, type NextRequest } from "next/server";
import { claimDueJobs, markJobDone, markJobFailed } from "@/lib/db/jobs";
import { processReminderJob } from "@/lib/reminders";
import { processClassifyJob } from "@/lib/ai/process";
import { processNotifyClientRetryJob } from "@/lib/notify-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && expected.trim() !== "") {
    const authHeader = request.headers.get("authorization") ?? "";
    let ok = authHeader === `Bearer ${expected}`;
    if (!ok && process.env.NODE_ENV !== "production") {
      const queryToken =
        new URL(request.url).searchParams.get("secret") ?? "";
      ok = queryToken === expected;
    }
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const claimed = await claimDueJobs(25);
  const results: {
    id: string;
    kind: string;
    ok: boolean;
    detail?: unknown;
  }[] = [];

  for (const job of claimed) {
    try {
      if (job.kind === "send_reminder") {
        const r = await processReminderJob(job.payload);
        results.push({ id: job.id, kind: job.kind, ok: true, detail: r });
      } else if (job.kind === "classify_document") {
        const r = await processClassifyJob(job.payload);
        results.push({ id: job.id, kind: job.kind, ok: true, detail: r });
      } else if (job.kind === "notify_client_retry") {
        const r = await processNotifyClientRetryJob(job.payload);
        results.push({ id: job.id, kind: job.kind, ok: true, detail: r });
      } else {
        results.push({
          id: job.id,
          kind: job.kind,
          ok: false,
          detail: "unknown_kind",
        });
      }
      await markJobDone(job.id);
    } catch (e) {
      console.error("[cron] job failed:", job.id, e);
      await markJobFailed(job.id, (e as Error).message ?? String(e));
      results.push({
        id: job.id,
        kind: job.kind,
        ok: false,
        detail: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    claimed: claimed.length,
    results,
  });
}
