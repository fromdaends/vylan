import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { readQuickbooksLists } from "@/lib/quickbooks/read";

export const runtime = "nodejs";

// GET /api/integrations/quickbooks/lists
//
// Returns the connected company's reference lists (accounts, vendors, customers,
// tax codes) — READ-ONLY. Available to ANY firm member; only connect/disconnect
// are owner-only. Strictly firm-scoped. Always 200: a soft { error } / per-list
// null lets the UI show a calm note instead of breaking.
export async function GET() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ lists: null, error: "unauthenticated" });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ lists: null, error: "unauthenticated" });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ lists: null, error: "no_firm" });
  }

  const result = await readQuickbooksLists(firm.id);
  if (result.ok) {
    return NextResponse.json({ lists: result.data });
  }
  return NextResponse.json({ lists: null, error: result.reason });
}
