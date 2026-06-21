import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { readChartOfAccounts } from "@/lib/quickbooks/read";

export const runtime = "nodejs";

// GET /api/integrations/quickbooks/accounts
//
// Returns the connected company's Chart of Accounts (READ-ONLY). Available to ANY
// firm member — reading reference data is not firm-admin; only connect/disconnect
// are owner-only. Always responds 200: a soft { error } lets the UI show a calm
// "couldn't load" note instead of a broken page.
export async function GET() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ accounts: null, error: "unauthenticated" });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ accounts: null, error: "unauthenticated" });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ accounts: null, error: "no_firm" });
  }

  const result = await readChartOfAccounts(firm.id);
  if (result.ok) {
    return NextResponse.json({ accounts: result.data });
  }
  return NextResponse.json({ accounts: null, error: result.reason });
}
