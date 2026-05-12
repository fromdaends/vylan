import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import {
  findItemForToken,
  setItemStatus,
  markEngagementInProgress,
  logActivity,
} from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/db/jobs";
import {
  MAX_BYTES,
  isAllowedMime,
  isHeic,
  convertHeicToJpeg,
  uploadObject,
  storagePath,
} from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const token = form.get("token");
  const itemId = form.get("item_id");
  const file = form.get("file");

  if (typeof token !== "string" || typeof itemId !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (!isAllowedMime(file.type)) {
    return NextResponse.json({ error: "bad_mime" }, { status: 415 });
  }

  const item = await findItemForToken(token, itemId);
  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // HEIC → JPEG: store the converted JPEG for previewability.
  let storedBytes: Buffer = bytes;
  let storedMime = file.type;
  let storedName = file.name;
  if (isHeic(file.type)) {
    try {
      storedBytes = await convertHeicToJpeg(bytes);
      storedMime = "image/jpeg";
      storedName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    } catch (e) {
      console.error("[portal/upload] HEIC convert failed:", e);
      // Fall back to storing the original HEIC so the user isn't blocked.
    }
  }

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (!engagement) {
    return NextResponse.json({ error: "engagement_gone" }, { status: 404 });
  }

  const uuid = nanoid(12);
  const path = storagePath({
    firmId: engagement.firm_id,
    engagementId: engagement.id,
    itemId: item.id,
    uuid,
    filename: storedName,
  });

  try {
    await uploadObject({
      path,
      body: storedBytes,
      contentType: storedMime,
    });
  } catch (e) {
    console.error("[portal/upload] storage upload failed:", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { data: inserted, error: insertErr } = await sb
    .from("uploaded_files")
    .insert({
      request_item_id: item.id,
      engagement_id: engagement.id,
      storage_path: path,
      original_filename: file.name,
      mime_type: storedMime,
      size_bytes: storedBytes.length,
      uploaded_by_ip: ip,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[portal/upload] db insert failed:", insertErr);
    return NextResponse.json({ error: "db_failed" }, { status: 500 });
  }

  await setItemStatus(item.id, "submitted");
  await markEngagementInProgress(engagement.id);
  await logActivity(engagement.firm_id, engagement.id, "client_uploaded", {
    item_id: item.id,
    filename: file.name,
    size_bytes: storedBytes.length,
  });

  // Fire-and-forget: enqueue an AI classification job. Runs at next cron tick.
  await enqueueJob({
    kind: "classify_document",
    payload: { uploaded_file_id: inserted.id },
    runAfter: new Date(),
  });

  return NextResponse.json({ ok: true });
}
