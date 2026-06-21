import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { readQuickbooksLists } from "@/lib/quickbooks/read";
import {
  getFirmSyncState,
  readCachedQuickbooksLists,
} from "@/lib/db/quickbooks-cache";
import { enqueueQuickbooksSync } from "@/lib/quickbooks/sync";

export const runtime = "nodejs";

// GET /api/integrations/quickbooks/lists
//
// Returns the firm's QuickBooks reference lists (accounts, vendors, customers,
// tax codes) — READ-ONLY, any firm member, strictly firm-scoped. Serves from the
// LOCAL CACHE (fast) once a sync has run; otherwise falls back to a LIVE read and
// kicks off the first cache sync (self-heal). Degrades gracefully before the
// cache migration (0420) is applied: it just keeps reading live. Always 200; a
// soft { error } / per-list null lets the UI show a calm note.
export async function GET() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ lists: null, syncState: null, error: "unauthenticated" });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ lists: null, syncState: null, error: "unauthenticated" });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ lists: null, syncState: null, error: "no_firm" });
  }

  // syncState is non-null only when 0420 is applied AND the firm is connected.
  const [syncState, cached] = await Promise.all([
    getFirmSyncState(),
    readCachedQuickbooksLists(),
  ]);

  // Fast path: cache exists and a sync has produced data.
  if (cached && syncState && syncState.lastSyncedAt) {
    return NextResponse.json({ lists: cached, syncState });
  }

  // Fallback: pre-0420, or connected-but-never-synced. Read live so the user is
  // never empty, and self-heal by enqueuing the first sync to populate the cache
  // (only when 0420 is applied and we've genuinely never synced -> status idle).
  if (syncState && syncState.status === "idle") {
    await enqueueQuickbooksSync(firm.id);
  }
  const live = await readQuickbooksLists(firm.id);
  const effectiveSync =
    syncState && syncState.status === "idle"
      ? { ...syncState, status: "syncing" as const }
      : syncState;
  if (live.ok) {
    return NextResponse.json({ lists: live.data, syncState: effectiveSync });
  }
  return NextResponse.json({
    lists: null,
    syncState: effectiveSync,
    error: live.reason,
  });
}
