// Vercel Cron handler — fires the founder-notify emails for demo
// leads, 5 minutes after the prospect's last activity. Wired in
// vercel.json on a `*/5 * * * *` schedule.
//
// Why we wait: each form submission (step 1, 2, 3) updates the row's
// `updated_at`. If we fired immediately on every step we'd spam the
// founder with multiple emails per lead (one for partial, one for
// qualified, one for booking). Debouncing for 5 minutes of inactivity
// guarantees ONE consolidated email per lead, with whatever info we
// captured by then.
//
// Auth model matches /api/cron/process-jobs: Bearer + Vercel-injected
// CRON_SECRET, with a ?secret= fallback in dev only.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { notifyFounderLead } from "@/lib/demo-notify";
import { pushLeadToNotion } from "@/lib/notion";
import type { DemoRequest } from "@/lib/db/demo-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Time the prospect's row must sit untouched before we fire the
// email. 5 min is the founder-specified setting; loose enough that
// real users almost never get cut off mid-form (median form fill is
// ~90 seconds), tight enough that the founder hears about abandoned
// leads while the prospect is still warm.
const QUIET_MS = 5 * 60 * 1000;

// Process at most this many rows per cron tick. Plenty of headroom
// for normal volume; bounds runtime if a batch processing job ever
// gets backed up.
const BATCH_SIZE = 50;

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

  const sb = getServiceRoleSupabase();
  const cutoff = new Date(Date.now() - QUIET_MS).toISOString();
  const { data, error } = await sb
    .from("demo_requests")
    .select("*")
    .is("notified_at", null)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/demo-leads] select failed:", error);
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ processed: 0, scanned: 0 });
  }

  const failures: string[] = [];
  let processed = 0;

  for (const row of data as DemoRequest[]) {
    try {
      const res = await notifyFounderLead(row);
      if (res && "sent" in res && !res.sent) {
        // Email send returned a failure (e.g. Resend not configured,
        // domain rejected, etc). Log loudly but still mark notified
        // so we don't endlessly retry — the lead row is the source
        // of truth and the founder can find it there.
        console.warn(
          "[cron/demo-leads] send returned not-sent for",
          row.id,
          res,
        );
      }
      // Mirror the lead into the founder's Notion database. Best-
      // effort: if Notion is misconfigured we log and keep going.
      try {
        await pushLeadToNotion(row);
      } catch (e) {
        console.error("[cron/demo-leads] notion push failed:", row.id, e);
      }
      const { error: upErr } = await sb
        .from("demo_requests")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) {
        console.error("[cron/demo-leads] mark-notified failed:", row.id, upErr);
        failures.push(row.id);
        continue;
      }
      processed++;
    } catch (e) {
      console.error("[cron/demo-leads] unhandled error:", row.id, e);
      failures.push(row.id);
    }
  }

  return NextResponse.json({
    scanned: data.length,
    processed,
    failures: failures.length ? failures : undefined,
  });
}
