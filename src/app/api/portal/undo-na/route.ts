import { NextResponse, type NextRequest } from "next/server";
import {
  findItemForToken,
  setItemStatus,
  logActivity,
} from "@/lib/db/portal";
import { recomputeItemStatus } from "@/lib/db/file-review";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  checkRateLimit,
  PORTAL_MUTATION_PER_TOKEN,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const itemId = body?.item_id;
  if (typeof token !== "string" || typeof itemId !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const rl = await checkRateLimit({
    key: `portal:mutation:token:${token}`,
    ...PORTAL_MUTATION_PER_TOKEN,
  });
  if (!rl.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }
  const item = await findItemForToken(token, itemId);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Clear the 'na' choice, then re-derive the item summary from its files
  // (which may be approved / rejected / pending under the per-file model).
  const sb = getServiceRoleSupabase();
  await setItemStatus(item.id, "pending", item.engagement_id);
  await recomputeItemStatus(sb, item.id);

  const { data: e } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (e) {
    await logActivity(e.firm_id, item.engagement_id, "client_undid_na", {
      item_id: item.id,
    });
  }
  return NextResponse.json({ ok: true });
}
