import { NextResponse, type NextRequest } from "next/server";
import {
  findItemForToken,
  setItemStatus,
  logActivity,
} from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const itemId = body?.item_id;
  if (typeof token !== "string" || typeof itemId !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const item = await findItemForToken(token, itemId);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // If files exist for this item, flip back to submitted; otherwise pending.
  const sb = getServiceRoleSupabase();
  const { count } = await sb
    .from("uploaded_files")
    .select("*", { count: "exact", head: true })
    .eq("request_item_id", itemId);
  await setItemStatus(itemId, (count ?? 0) > 0 ? "submitted" : "pending");

  const { data: e } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (e) {
    await logActivity(e.firm_id, item.engagement_id, "client_undid_na", {
      item_id: itemId,
    });
  }
  return NextResponse.json({ ok: true });
}
