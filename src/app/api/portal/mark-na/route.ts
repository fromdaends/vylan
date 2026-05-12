import { NextResponse, type NextRequest } from "next/server";
import {
  findItemForToken,
  setItemStatus,
  markEngagementInProgress,
  logActivity,
} from "@/lib/db/portal";
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
  if (item.required) {
    return NextResponse.json({ error: "required_item" }, { status: 400 });
  }

  await setItemStatus(item.id, "na", item.engagement_id);

  const sb = getServiceRoleSupabase();
  const { data: e } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (e) {
    await markEngagementInProgress(item.engagement_id);
    await logActivity(e.firm_id, item.engagement_id, "client_marked_na", {
      item_id: item.id,
    });
  }
  return NextResponse.json({ ok: true });
}
