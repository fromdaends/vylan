import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { enqueueQuickbooksSync } from "@/lib/quickbooks/sync";

export const runtime = "nodejs";

// POST /api/integrations/quickbooks/sync
//
// Enqueues a background refresh of the firm's cached QuickBooks lists (the
// "Refresh from QuickBooks" button). Available to ANY firm member — reading and
// refreshing reference data is not owner-only. The actual pull runs via the jobs
// queue (every-2-min cron), so this returns immediately with status 'syncing';
// the lists update within a couple of minutes.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  await enqueueQuickbooksSync(firm.id);
  return NextResponse.json({ ok: true, status: "syncing" });
}
