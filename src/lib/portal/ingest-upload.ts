import { after } from "next/server";
import { nanoid } from "nanoid";
import { markEngagementInProgress, logActivity } from "@/lib/db/portal";
import type { RequestItem } from "@/lib/db/request-items";
import { recomputeItemStatus } from "@/lib/db/file-review";
import { computeContentHash } from "@/lib/files/content-hash";
import {
  findDuplicateOriginalId,
  decideDuplicate,
  applyDuplicateDecision,
} from "@/lib/duplicates";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/db/jobs";
import {
  clientName,
  emitDocumentUploaded,
  emitRequestComplete,
  emitSignedCopyReturned,
} from "@/lib/notifications/emit";
import { processClassifyJob } from "@/lib/ai/process";
import { scheduleSetAssessment } from "@/lib/ai/set-assessment";
import {
  isHeic,
  convertHeicToJpeg,
  uploadObject,
  storagePath,
} from "@/lib/storage";

// The portal upload pipeline AFTER the raw bytes are in hand: HEIC→JPEG,
// canonical storage write, fingerprint + duplicate routing, the DB row,
// item-status recompute, the signed-copy notification, and the AI classify
// kick-off. Extracted verbatim from /api/portal/upload so it is shared by
// BOTH intake paths:
//   * the legacy single-request route (bytes arrive in the form body — capped
//     at ~4.5 MB by the hosting platform, regardless of our own 25 MB limit)
//   * the direct-to-storage flow (/api/portal/upload-url + /upload-complete),
//     which exists precisely because of that platform cap: the browser PUTs
//     the bytes straight to storage and the complete route downloads them.
// Callers are responsible for upstream validation (token→item auth, size,
// mime, rate limits) — this function trusts its inputs the same way the
// original route body did.

export type PortalUploadEngagement = {
  id: string;
  firm_id: string;
  title: string;
  assigned_user_id: string | null;
  client_id: string;
};

export type IngestResult =
  | { ok: true; fileId: string; duplicate: boolean }
  | { ok: false; error: "upload_failed" | "db_failed" };

export async function ingestPortalUpload(opts: {
  bytes: Buffer;
  declaredMime: string;
  // Already truncated by the caller (truncateFilename).
  originalFilename: string;
  item: RequestItem;
  engagement: PortalUploadEngagement;
  uploadedByIp: string | null;
}): Promise<IngestResult> {
  const { bytes, item, engagement } = opts;
  const sb = getServiceRoleSupabase();

  // HEIC → JPEG: store the converted JPEG for previewability.
  let storedBytes: Buffer = bytes;
  let storedMime = opts.declaredMime;
  let storedName = opts.originalFilename;
  if (isHeic(opts.declaredMime)) {
    try {
      storedBytes = await convertHeicToJpeg(bytes);
      storedMime = "image/jpeg";
      storedName = opts.originalFilename.replace(/\.(heic|heif)$/i, ".jpg");
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
    return { ok: false, error: "upload_failed" };
  }

  // Duplicate detection: fingerprint the STORED bytes and look for an exact
  // match already in THIS engagement. Queried BEFORE the insert, so it only sees
  // the EARLIER files; a match means this upload is a byte-identical re-upload.
  const contentHash = computeContentHash(storedBytes);
  const { data: dupCandidates } = await sb
    .from("uploaded_files")
    .select("id, content_hash, uploaded_at")
    .eq("engagement_id", item.engagement_id);
  const duplicateOfId = findDuplicateOriginalId(
    contentHash,
    (dupCandidates ?? []) as {
      id: string;
      content_hash: string | null;
      uploaded_at: string;
    }[],
  );

  const { data: inserted, error: insertErr } = await sb
    .from("uploaded_files")
    .insert({
      request_item_id: item.id,
      engagement_id: item.engagement_id,
      storage_path: path,
      original_filename: opts.originalFilename,
      mime_type: storedMime,
      size_bytes: storedBytes.length,
      content_hash: contentHash,
      uploaded_by_ip: opts.uploadedByIp,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[portal/upload] db insert failed:", insertErr);
    return { ok: false, error: "db_failed" };
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

  // Duplicate: this upload is a byte-identical re-upload of an earlier file in
  // the engagement. Set it aside (it won't affect the item's status — the
  // original is what counts) and either auto-reject it or just flag it for
  // review, per the firm's SEPARATE duplicate setting. Skip the AI classify +
  // the signature notify; a duplicate needs neither.
  if (duplicateOfId) {
    const { data: firmRow } = await sb
      .from("firms")
      .select("auto_reject_duplicates")
      .eq("id", engagement.firm_id)
      .single();
    const { data: dupClient } = await sb
      .from("clients")
      .select("locale")
      .eq("id", engagement.client_id)
      .maybeSingle();
    const clientLocale: "fr" | "en" =
      dupClient?.locale === "en" ? "en" : "fr";
    await applyDuplicateDecision({
      supabase: sb,
      decision: decideDuplicate(Boolean(firmRow?.auto_reject_duplicates)),
      fileId: inserted.id,
      originalFileId: duplicateOfId,
      requestItemId: item.id,
      engagementId: item.engagement_id,
      firmId: engagement.firm_id,
      clientLocale,
    });
    return { ok: true, fileId: inserted.id, duplicate: true };
  }

  // Signature items take a different path: the client's upload IS the signed
  // copy of a document the accountant supplied, not a tax document to classify.
  // Skip AI classification entirely (it would wrongly flag a signed form as the
  // "wrong document") and instead notify the accountant that the signed copy
  // came back. recomputeItemStatus already moved the item to "in review".
  if (item.kind === "signature") {
    // Best-effort, off the response path — never fail the upload on a
    // notification. This used to send the accountant an email DIRECTLY; it now
    // goes through notify(), which is what gives the firm an off switch, a
    // feed row, and (critically) stops the same person being emailed twice
    // once the emitter also covers this event.
    after(async () => {
      const ctx = await engagementContext(sb, engagement);
      await emitSignedCopyReturned(sb, ctx, {
        documentName:
          item.label || item.label_fr || item.signing_doc_name || null,
      });
    });
    return { ok: true, fileId: inserted.id, duplicate: false };
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

  // Firm-facing notifications for a real (non-duplicate, non-signature)
  // document. Off the response path: the client's upload must never wait on,
  // or fail because of, telling the firm about it.
  after(async () => {
    const ctx = await engagementContext(sb, engagement);
    await emitDocumentUploaded(sb, ctx, { fileId: inserted.id });
    // Separately: has this upload finished the whole request?
    //
    // Two conditions, not one. "The request is complete" is true for EVERY
    // upload after the completing one, so on its own it would re-fire on every
    // later file — and this event does not bundle, so each would be a fresh
    // notification and a fresh email. The second condition is "this upload is
    // what completed it": the item it belongs to must have had no live file
    // before now, i.e. this is its first.
    if (
      (await isFirstLiveFileForItem(sb, item.id, inserted.id)) &&
      (await isRequestNowComplete(sb, item.engagement_id))
    ) {
      await emitRequestComplete(sb, ctx);
    }
  });

  // Set-aware analysis (Phase 1): debounce a single item-level assessment that
  // judges ALL of this item's non-duplicate files together. Each upload in a
  // burst pushes the one pending job ~2 min out, so a multi-photo document is
  // assessed as one set (and billed as one AI call), not page-by-page. Awaited
  // but self-contained + best-effort — it never throws into the upload path.
  await scheduleSetAssessment(item.id);

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

  return { ok: true, fileId: insertedFileId, duplicate: false };
}

// Shared context for every notification raised from a portal upload. One read
// for the client name; the rest is already on the engagement row.
async function engagementContext(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  engagement: PortalUploadEngagement,
): Promise<{
  firmId: string;
  engagementId: string;
  engagementTitle: string | null;
  clientId: string | null;
  clientName: string | null;
}> {
  return {
    firmId: engagement.firm_id,
    engagementId: engagement.id,
    engagementTitle: engagement.title,
    clientId: engagement.client_id,
    clientName: await clientName(sb, engagement.client_id),
  };
}

// Has this upload just completed the whole request? True only when every
// REQUIRED item now has at least one live (non-duplicate) file.
//
// Computed here rather than derived at render time so "everything is in"
// becomes a real event with a real timestamp that can be read and dismissed —
// the derived feed could only ever say "it is complete right now".
async function isRequestNowComplete(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  engagementId: string,
): Promise<boolean> {
  const [{ data: items }, { data: files }] = await Promise.all([
    sb
      .from("request_items")
      .select("id, required")
      .eq("engagement_id", engagementId),
    sb
      .from("uploaded_files")
      .select("request_item_id, is_duplicate")
      .eq("engagement_id", engagementId),
  ]);
  const required = (items ?? []).filter(
    (i) => (i as { required: boolean }).required,
  );
  if (required.length === 0) return false;
  const withFile = new Set(
    (files ?? [])
      .filter((f) => !(f as { is_duplicate?: boolean }).is_duplicate)
      .map((f) => (f as { request_item_id: string }).request_item_id),
  );
  return required.every((i) => withFile.has((i as { id: string }).id));
}

// Is the file we just inserted the FIRST live (non-duplicate) file for its
// request item? Used to fire "everything is in" exactly once: a later upload
// against an already-satisfied item cannot be the one that completed the set.
async function isFirstLiveFileForItem(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  requestItemId: string,
  justInsertedFileId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("uploaded_files")
    .select("id, is_duplicate")
    .eq("request_item_id", requestItemId);
  // On a read failure, stay quiet rather than risk a duplicate announcement.
  if (error) return false;
  const live = (data ?? []).filter(
    (f) => !(f as { is_duplicate?: boolean }).is_duplicate,
  );
  return live.length === 1 && (live[0] as { id: string }).id === justInsertedFileId;
}
