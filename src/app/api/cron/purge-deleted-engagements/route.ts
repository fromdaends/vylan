// Vercel Cron handler — runs daily (see vercel.json). Permanently removes
// engagements that have been soft-deleted for longer than the 30-day retention
// window, including their files in storage. This is the ONLY caller of the
// permanent delete; the UI's "delete" is always a recoverable soft-delete.
//
// Auth model mirrors process-jobs:
//   * Production: Vercel injects `Authorization: Bearer <CRON_SECRET>`.
//   * Dev (NODE_ENV !== "production"): a ?secret= fallback is allowed so
//     `curl localhost:3000/api/cron/...` works without forging headers.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { purgeExpiredDeletedEngagements } from "@/lib/engagements/purge";

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

  // Service role: no user session in a cron, and the purge spans the whole
  // platform's expired rows (RLS would otherwise scope to nobody).
  const sb = getServiceRoleSupabase();

  const result = await purgeExpiredDeletedEngagements({
    supabase: sb,
    removeStorageObjects: async (paths) => {
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    },
    nowMs: Date.now(),
  });

  if (result.failed.length > 0) {
    console.error("[cron] purge had failures:", result.failed);
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    purgedCount: result.purged.length,
    filesRemoved: result.filesRemoved,
    failedCount: result.failed.length,
  });
}
