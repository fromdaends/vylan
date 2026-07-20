// Create a QuickBooks name-list entity (Vendor / Customer) inline — the draft-card
// picker's "+ Create '<name>'" affordance for a party the receipt names but the
// firm doesn't have in QuickBooks yet. Auth (firm member) + the connection is the
// authorization; the write goes to the firm's OWN connected company only.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getDraftForFile } from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import {
  createOrFindNameEntity,
  normalizeEntityName,
} from "@/lib/quickbooks/create-entity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const kind = body?.kind;
  if (kind !== "vendor" && kind !== "customer") {
    return NextResponse.json(
      { error: "bad_kind", detail: "kind must be 'vendor' or 'customer'." },
      { status: 400 },
    );
  }
  const name = normalizeEntityName(body?.name);
  if (!name) {
    return NextResponse.json(
      {
        error: "bad_name",
        detail: "Enter a name (1–100 characters, no colon).",
      },
      { status: 400 },
    );
  }
  // The draft this "+ Create" was fired from, so we create the party in THAT
  // client's QuickBooks company (0710 per-client). A stale client omitting it
  // falls back to firm-level scope.
  const fileId =
    typeof body?.fileId === "string" && body.fileId ? body.fileId : null;

  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json(
      { error: "no_firm", detail: "No firm for this user." },
      { status: 403 },
    );
  }

  // Resolve the draft's client (RLS-scoped read — also confirms the file belongs
  // to this firm). undefined = firm-level fallback (no fileId / draft not found).
  const clientId = fileId
    ? ((await getDraftForFile(fileId))?.clientId ?? null)
    : undefined;

  const ctx = await getQuickbooksReadContext(firm.id, clientId);
  if (!ctx) {
    return NextResponse.json(
      { error: "not_connected", detail: "QuickBooks isn't connected." },
      { status: 409 },
    );
  }

  const result = await createOrFindNameEntity({
    firmId: firm.id,
    kind,
    name,
    ctx,
    now: new Date().toISOString(),
    clientId,
  });
  if (!result.ok) {
    // Duplicate is a soft/expected outcome (409); any other failure is a 502 from
    // QuickBooks. The client surfaces `detail`.
    return NextResponse.json(
      { error: result.reason, detail: result.detail },
      { status: result.reason === "duplicate" ? 409 : 502 },
    );
  }
  return NextResponse.json({ ok: true, entity: result.entity });
}
