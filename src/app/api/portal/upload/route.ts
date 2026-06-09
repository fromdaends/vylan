import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { nanoid } from "nanoid";
import {
  findItemForToken,
  markEngagementInProgress,
  logActivity,
  resolveAccountantContact,
} from "@/lib/db/portal";
import type { RequestItem } from "@/lib/db/request-items";
import { sendEmail, buildSignedCopyReturnedEmail } from "@/lib/email";
import { recomputeItemStatus } from "@/lib/db/file-review";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/db/jobs";
import { processClassifyJob } from "@/lib/ai/process";
import {
  MAX_BYTES,
  MAX_HEIC_INPUT_BYTES,
  isAllowedMime,
  isHeic,
  convertHeicToJpeg,
  uploadObject,
  storagePath,
  truncateFilename,
} from "@/lib/storage";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_UPLOAD_PER_TOKEN,
  PORTAL_UPLOAD_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

function tooMany(retryAfter?: number) {
  const res = NextResponse.json(
    { error: "rate_limited" },
    { status: 429 },
  );
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function POST(request: NextRequest) {
  const ip = ipFromRequest(request);
  const ipForDb = ip === "unknown" ? null : ip;

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

  // Rate limit BEFORE touching storage or the DB. Use both the token and
  // the client IP so a single attacker can't burn through a magic link by
  // rotating either dimension.
  const rlToken = await checkRateLimit({
    key: `portal:upload:token:${token}`,
    ...PORTAL_UPLOAD_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:upload:ip:${ip}`,
    ...PORTAL_UPLOAD_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

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
  // Reject oversize HEIC before the decoder gets a chance to OOM on crafted
  // dimensions. Legitimate iPhone photos sit well below this cap.
  if (isHeic(file.type) && file.size > MAX_HEIC_INPUT_BYTES) {
    return NextResponse.json({ error: "heic_too_large" }, { status: 413 });
  }

  const item = await findItemForToken(token, itemId);
  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Look up the engagement once — we already have a validated
  // item.engagement_id. firm_id powers storage paths + activity logs; the other
  // fields are only used to notify the accountant when a signature item's signed
  // copy is returned (see the signature branch below).
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, title, assigned_user_id, client_id")
    .eq("id", item.engagement_id)
    .single();
  if (!engagement) {
    return NextResponse.json({ error: "engagement_gone" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeOriginalName = truncateFilename(file.name);

  // HEIC → JPEG: store the converted JPEG for previewability.
  let storedBytes: Buffer = bytes;
  let storedMime = file.type;
  let storedName = safeOriginalName;
  if (isHeic(file.type)) {
    try {
      storedBytes = await convertHeicToJpeg(bytes);
      storedMime = "image/jpeg";
      storedName = safeOriginalName.replace(/\.(heic|heif)$/i, ".jpg");
    } catch (e) {
      console.error("[portal/upload] HEIC convert failed:", e);
      // Fall back to storing the original HEIC so the user isn't blocked.
    }
  }

  const uuid = nanoid(12);
  const path = storagePath({
    firmId: engagement.firm_id,
    engagementId: item.engagement_id,
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
      engagement_id: item.engagement_id,
      storage_path: path,
      original_filename: safeOriginalName,
      mime_type: storedMime,
      size_bytes: storedBytes.length,
      uploaded_by_ip: ipForDb,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[portal/upload] db insert failed:", insertErr);
    return NextResponse.json({ error: "db_failed" }, { status: 500 });
  }

  // Re-derive the item summary from its files now that this new (pending) file
  // exists. A fresh upload answers any prior rejection, so the item moves to
  // "in review"; recomputeItemStatus also clears any stale rejection reason
  // (the old item-level setItemStatus("submitted") + manual reason-clear).
  await recomputeItemStatus(sb, item.id);
  await markEngagementInProgress(item.engagement_id);
  // Activity-log metadata MUST NOT contain client PII (Phase 5). The
  // log row is retained for 2 years; filenames frequently contain
  // client names ("Jean_Tremblay_T4_2024.pdf") and would survive the
  // file itself. Store the uploaded_files row id instead — the
  // timeline UI looks up the live filename at render time, so PII
  // only lives as long as the file does.
  await logActivity(engagement.firm_id, item.engagement_id, "client_uploaded", {
    item_id: item.id,
    file_id: inserted.id,
    size_bytes: storedBytes.length,
  });

  // Signature items take a different path: the client's upload IS the signed
  // copy of a document the accountant supplied, not a tax document to classify.
  // Skip AI classification entirely (it would wrongly flag a signed form as the
  // "wrong document") and instead notify the accountant that the signed copy
  // came back. recomputeItemStatus already moved the item to "in review".
  if (item.kind === "signature") {
    const engForEmail = {
      id: engagement.id as string,
      firm_id: engagement.firm_id as string,
      title: (engagement.title as string) ?? "",
      assigned_user_id: (engagement.assigned_user_id as string | null) ?? null,
      client_id: engagement.client_id as string,
    };
    // Best-effort, off the response path — never fail the upload on email.
    after(async () => {
      try {
        await notifyAccountantSignedCopyReturned(engForEmail, item);
      } catch (e) {
        console.error("[portal/upload] signed-copy notification failed:", e);
      }
    });
    return NextResponse.json({ ok: true, file_id: inserted.id });
  }

  // Enqueue an AI classification job as a durable fallback (cron retries).
  // We ALSO kick off the same work via after() so the verdict lands within
  // seconds, but the response returns to the client immediately — the
  // browser was previously waiting for Anthropic to read the PDF before
  // "upload complete" cleared, which felt like 5-15s of dead air. The
  // portal UI polls /api/portal/upload-status to surface the verdict.
  await enqueueJob({
    kind: "classify_document",
    payload: { uploaded_file_id: inserted.id },
    runAfter: new Date(),
  });

  const insertedFileId = inserted.id;
  const bytesForAi = storedBytes;
  const mimeForAi = storedMime;

  after(async () => {
    try {
      const result = await processClassifyJob(
        { uploaded_file_id: insertedFileId },
        { bytes: bytesForAi, mimeType: mimeForAi },
      );
      if (result.classified) {
        // Mark the queued job done so the cron skips it. The .eq("status",
        // "pending") guard makes this a no-op if the cron raced us — at
        // worst we do one duplicate classification, never lose one.
        await sb
          .from("jobs")
          .update({ status: "done", last_error: "processed_inline" })
          .eq("kind", "classify_document")
          .eq("status", "pending")
          .eq("payload->>uploaded_file_id", insertedFileId);
      }
    } catch (e) {
      // AI failure must not break the upload — the file is already saved
      // and the cron will retry classification later (the job row stays
      // pending). The client's poll will hit our retry window and then
      // time out gracefully.
      console.error("[portal/upload] background classification failed:", e);
    }
  });

  return NextResponse.json({ ok: true, file_id: insertedFileId });
}

// Email the accountant that a client returned the signed copy of a signature
// item. Service-role reads only (the portal is unauthenticated). Resolves the
// SAME "your accountant" contact the portal footer uses (assigned user, falling
// back to the firm owner) and writes in that accountant's own language. The
// document name follows the accountant's language too. Throws are swallowed by
// the caller's try/catch — a notification must never break the upload.
async function notifyAccountantSignedCopyReturned(
  engagement: {
    id: string;
    firm_id: string;
    title: string;
    assigned_user_id: string | null;
    client_id: string;
  },
  item: RequestItem,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const contact = await resolveAccountantContact(sb, {
    assignedUserId: engagement.assigned_user_id,
    firmId: engagement.firm_id,
  });
  if (!contact?.email) return;

  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", engagement.client_id)
    .maybeSingle();

  const documentName =
    (contact.locale === "fr"
      ? item.label_fr || item.label
      : item.label || item.label_fr) ||
    item.signing_doc_name ||
    "document";

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const reviewUrl = `${appUrl}/${contact.locale}/engagements/${engagement.id}`;

  const { subject, html, text } = buildSignedCopyReturnedEmail({
    accountantName: contact.name,
    clientName:
      (client?.display_name as string | undefined) ||
      (contact.locale === "fr" ? "Votre client" : "Your client"),
    documentName,
    engagementTitle: engagement.title,
    reviewUrl,
    locale: contact.locale,
  });
  await sendEmail({ to: contact.email, subject, html, text });
}
