// Reject a checklist ITEM via a STABLE API endpoint (POST /api/items/[id]/reject)
// instead of a Server Action. Same rationale as the add-item route: server-action
// invocations are addressed by a hashed id baked into the client bundle, so after
// a redeploy a browser holding the old bundle calls an action id the live server
// no longer resolves — the call fails before it runs and the UI just stalls
// ("I clicked reject and nothing happened"). A URL endpoint is stable across
// deploys, so this can't happen.
//
// Auth + firm scoping: getServerSupabase carries the accountant's session; the
// item is read under RLS (the row is only visible when it belongs to
// current_firm_id()), which IS the authorization check.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { rejectItem } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Could not read the form." },
      { status: 400 },
    );
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 2) {
    return NextResponse.json({ fieldErrors: { reason: "min_2_chars" } });
  }
  if (reason.length > 500) {
    return NextResponse.json({ fieldErrors: { reason: "too_long" } });
  }

  // Authorize + resolve context in one RLS-scoped read. A row for another firm
  // simply isn't returned, so a missing row == not authorized.
  const { data: row } = await supabase
    .from("request_items")
    .select("engagement_id, engagements!inner(firm_id)")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "not_found", detail: "Item not found." },
      { status: 404 },
    );
  }
  const engagementId = (row as { engagement_id: string }).engagement_id;
  const e = (row as { engagements: { firm_id: string } | { firm_id: string }[] })
    .engagements;
  const firmId = Array.isArray(e) ? e[0]?.firm_id : e?.firm_id;

  try {
    await rejectItem(id, reason); // RLS enforces firm ownership
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[reject item route] failed:", detail, err);
    return NextResponse.json({ error: "reject_failed", detail });
  }

  // Best-effort: logging + revalidation must never fail an already-applied reject.
  try {
    if (firmId) {
      await logUserActivity(firmId, engagementId, "reject_item", { item_id: id });
    }
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${engagementId}`);
      revalidatePath(`/${loc}/dashboard`);
    }
  } catch (err) {
    console.error("[reject item route] post-step failed (reject applied):", err);
  }

  return NextResponse.json({ ok: true });
}
