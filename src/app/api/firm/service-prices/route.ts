import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { updateCurrentFirm } from "@/lib/db/firms";

export const runtime = "nodejs";

// POST /api/firm/service-prices
// Body: { prices: { t1?: number, t2?: number, bookkeeping?: number } } in CENTS.
// Owner-only. Stores the firm's per-service default payment prices so the
// Request-payment dialog can pre-fill. A value of 0 / missing clears that type.
const TYPES = ["t1", "t2", "bookkeeping"] as const;

export async function POST(request: NextRequest) {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { prices?: Record<string, unknown> }
    | null;
  const incoming = body?.prices ?? {};

  // Only accept the known engagement types; keep positive integer cents, drop
  // anything else (0 / empty / invalid clears that type's default).
  const prices: Record<string, number> = {};
  for (const type of TYPES) {
    const raw = incoming[type];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= 99_999_999) {
      prices[type] = n;
    }
  }

  try {
    await updateCurrentFirm({ service_prices: prices });
  } catch (e) {
    console.error("[firm/service-prices] save failed:", e);
    // Most likely the column doesn't exist yet (migration 0380 not applied).
    return NextResponse.json({ error: "save_failed" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, prices });
}
