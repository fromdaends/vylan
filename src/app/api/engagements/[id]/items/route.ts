// Add a checklist item via a STABLE API endpoint (POST /api/engagements/[id]/items)
// instead of a Next.js Server Action. Server-action invocations are addressed by
// a hashed id baked into the client bundle; after rapid redeploys the browser
// can hold a bundle whose action id the live server no longer resolves, so the
// call fails before it ever runs (the "Couldn't add the item" loop). An API
// route is addressed by URL — stable across deploys — so this can't happen.
//
// Auth + firm scoping are enforced exactly as the action did: getServerSupabase
// carries the accountant's session, and addItemToEngagement inserts under RLS
// (the row-level policy requires the engagement to belong to current_firm_id()).

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { addItemToEngagement, type NewItemInput } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import {
  addItemSchema,
  pickAddItemFields,
} from "@/lib/engagements/add-item-fields";

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

  const parsed = addItemSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const detail =
      "Invalid fields: " +
      parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ");
    return NextResponse.json({ fieldErrors, detail });
  }

  const { label, description } = pickAddItemFields(parsed.data);
  if (!label) {
    return NextResponse.json({ fieldErrors: { label: "required" } });
  }

  const input: NewItemInput = {
    engagement_id: id, // from the URL path — never missing
    label,
    label_fr: label,
    description,
    description_fr: description,
    doc_type: parsed.data.doc_type as NewItemInput["doc_type"],
    required: parsed.data.required,
    ai_rules: parsed.data.ai_rules ?? null,
  };

  let item;
  try {
    item = await addItemToEngagement(input); // RLS enforces firm ownership
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[add_item route] insert failed:", detail, e);
    return NextResponse.json({ error: "add_failed", detail });
  }

  // Best-effort: logging + revalidation must never fail an already-written add.
  try {
    const { data: eng } = await supabase
      .from("engagements")
      .select("firm_id")
      .eq("id", item.engagement_id)
      .single();
    if (eng) {
      await logUserActivity(eng.firm_id, item.engagement_id, "add_item", {
        item_id: item.id,
        label,
      });
    }
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${id}`);
      revalidatePath(`/${loc}/dashboard`);
    }
  } catch (e) {
    console.error("[add_item route] post-insert step failed (item WAS added):", e);
  }

  return NextResponse.json({ ok: true, id: item.id });
}
