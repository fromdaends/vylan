import { getServiceRoleSupabase } from "@/lib/supabase/server";

import { safeStorageName } from "@/lib/files/safe-name";

export const BUCKET = "client-uploads";
export const MAX_BYTES = 25 * 1024 * 1024;
// HEIC decoder allocates `width * height * 4` bytes during decode, so a small
// file with crafted dimensions can OOM the runtime. Real iPhone HEIC photos
// are under 5 MB; cap below the general limit as a defense.
export const MAX_HEIC_INPUT_BYTES = 10 * 1024 * 1024;
// Maximum filename length stored in the DB / used in storage keys. Long names
// can break ICU message rendering and bloat rows.
export const MAX_FILENAME_LEN = 200;

// Branding image uploads (firm logo, user avatar) get processed into a
// 512×512 JPEG before storage. The pre-process cap is generous for an
// iPhone photo; the hard cap prevents memory-bomb uploads from reaching
// sharp/heic-convert at all.
export const MAX_BRANDING_BYTES = 8 * 1024 * 1024;
export const MAX_BRANDING_HARD_LIMIT = 20 * 1024 * 1024;
export const BRANDING_OUTPUT_SIZE = 512;
export const BRANDING_URL_TTL_SEC = 24 * 60 * 60;
// Logos embedded in outgoing emails need a TTL that outlives the reminder
// cadence. Reminders go out up to ~30 days after the engagement is sent,
// and clients sometimes open them later still. 90 days covers the long
// tail; if a client opens an email older than that, the alt text takes
// over and the rest of the email still renders.
export const BRANDING_URL_EMAIL_TTL_SEC = 90 * 24 * 60 * 60;

export function truncateFilename(name: string): string {
  if (name.length <= MAX_FILENAME_LEN) return name;
  // Preserve the extension when truncating.
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 16) {
    const ext = name.slice(dot);
    return name.slice(0, MAX_FILENAME_LEN - ext.length) + ext;
  }
  return name.slice(0, MAX_FILENAME_LEN);
}

const HEIC_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

// Machine-readable document types (spreadsheets + CSV) the vision model can't
// open. We read their text in code (see src/lib/ai/readable-extract.ts) so the
// AI can still verify them against the checklist. Accepting them lets those
// files flow through the portal like any other upload.
const READABLE_DOC_MIMES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // legacy .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  ...HEIC_MIMES,
  ...READABLE_DOC_MIMES,
]);

export function isHeic(mime: string): boolean {
  return HEIC_MIMES.has(mime.toLowerCase());
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime.toLowerCase());
}

export function storagePath(parts: {
  firmId: string;
  engagementId: string;
  itemId: string;
  uuid: string;
  filename: string;
}): string {
  // safeStorageName, not just slash/space cleanup: Supabase rejects keys with
  // accented characters, so "Régie de l'assurance.jpeg" must become
  // "Regie_de_l_assurance.jpeg" or the storage write fails outright. The
  // DB keeps the original filename for display.
  const safeName = safeStorageName(parts.filename);
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/items/${parts.itemId}/${parts.uuid}-${safeName}`;
}

// Staging area for DIRECT browser uploads (the /api/portal/upload-url →
// /upload-complete flow). The browser PUTs raw bytes here via a short-lived
// signed upload URL — bypassing the hosting platform's ~4.5 MB function-body
// cap — and the complete route then validates, converts (HEIC), and writes
// the canonical object via storagePath() before deleting the staging copy.
// Same firm prefix as everything else so the bucket's RLS scoping applies.
export function stagingUploadPath(parts: {
  firmId: string;
  engagementId: string;
  itemId: string;
  uuid: string;
  filename: string;
}): string {
  const safeName = safeStorageName(parts.filename);
  return `${stagingPrefixForItem(parts)}${parts.uuid}-${safeName}`;
}

// The prefix every staging object for one checklist item lives under. The
// complete route REQUIRES the client-echoed path to start with the prefix
// derived from its own token→item lookup, so a caller can never finalize an
// object outside the item their magic link grants.
export function stagingPrefixForItem(parts: {
  firmId: string;
  engagementId: string;
  itemId: string;
}): string {
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/items/${parts.itemId}/staging/`;
}

// Chunked staging (the path that actually works from browsers): the portal
// posts a big file as sequential ~3.5 MB parts through OUR domain — each
// request fits the hosting platform's ~4.5 MB function-body cap, and being
// same-origin there is no CORS preflight to fail (the browser→Supabase
// signed-URL PUT dies in preflight: the storage gateway answers OPTIONS on
// /object/upload/sign/* with 400 "Bucket not found", so no browser will send
// the bytes — verified against production 2026-06-10). The complete route
// reassembles the parts in order and runs the normal pipeline.
export const UPLOAD_PART_BYTES = 3.5 * 1024 * 1024; // client chunk size
export const MAX_UPLOAD_PARTS = 8; // ceil(25 MB / 3.5 MB)

// Client-supplied upload ids are embedded in storage paths — accept only a
// strict charset so they can't traverse or collide with anything.
export function isValidUploadId(id: string): boolean {
  return /^[A-Za-z0-9-]{8,40}$/.test(id);
}

export function stagingPartPath(parts: {
  firmId: string;
  engagementId: string;
  itemId: string;
  uploadId: string;
  seq: number;
}): string {
  return `${stagingPrefixForItem(parts)}${parts.uploadId}/part-${parts.seq}`;
}

// Short-lived signed URL the browser PUTs the file to. Service-role: the
// portal is unauthenticated; the route that calls this has already validated
// the magic token and generated the path itself.
export async function createUploadUrl(
  path: string,
): Promise<{ signedUrl: string; token: string }> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("signed_upload_url_failed");
  return { signedUrl: data.signedUrl, token: data.token };
}

export async function downloadObject(path: string): Promise<Buffer> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error("download_failed");
  return Buffer.from(await data.arrayBuffer());
}

// Best-effort delete (staging cleanup). Never throws — an orphaned staging
// object is harmless and invisible to every reader (nothing references it).
export async function removeObjectQuiet(path: string): Promise<void> {
  try {
    const sb = getServiceRoleSupabase();
    await sb.storage.from(BUCKET).remove([path]);
  } catch (e) {
    console.warn("[storage] staging cleanup failed for", path, e);
  }
}

// Storage path for the blank document an accountant uploads to be signed. Sits
// under the same firm prefix as client uploads (so the firm-scoped bucket RLS
// applies) but in a `signing/` folder, separate from the client's returned copy.
export function signingDocPath(parts: {
  firmId: string;
  engagementId: string;
  uuid: string;
  filename: string;
}): string {
  // Same accent-safe key rule as storagePath — accountants name signature
  // documents in French too ("Procuration spéciale.pdf").
  const safeName = safeStorageName(parts.filename);
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/signing/${parts.uuid}-${safeName}`;
}

// The completed, signed PDF (with SignWell's audit page) returned after the
// client signs. Keyed by the SignWell document id so re-processing the same
// document overwrites the same object (idempotent upsert).
export function signedDocPath(parts: {
  firmId: string;
  engagementId: string;
  documentId: string;
}): string {
  const safeId = safeStorageName(parts.documentId);
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/signed/${safeId}.pdf`;
}

export type BrandingKind = "firm_logo" | "user_avatar";

// Storage paths for branding images. Both sit under the firm prefix so the
// existing `firms/{firm_id}/...` RLS on the bucket continues to apply.
export function brandingStoragePath(parts: {
  firmId: string;
  kind: BrandingKind;
  userId?: string;
  uuid: string;
  ext: string;
}): string {
  const safeExt = parts.ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  if (parts.kind === "firm_logo") {
    return `firms/${parts.firmId}/branding/logo-${parts.uuid}.${safeExt}`;
  }
  // user_avatar requires userId
  if (!parts.userId) {
    throw new Error("brandingStoragePath: userId required for user_avatar");
  }
  return `firms/${parts.firmId}/users/${parts.userId}/avatar-${parts.uuid}.${safeExt}`;
}

// Branding images are referenced repeatedly (every page load), so use a
// longer TTL than per-file downloads. 24h means we can cache the URL in
// memory for the session without re-signing on every render.
//
// Errors here MUST NOT throw — these helpers run inside page renders
// (layout, /profile, /portal) and a throw cascades into a 500 page for
// the entire route. The original 0001 schema stored URLs in
// `firms.logo_url`, and Phase 3a started writing storage paths instead;
// a row with a stale string from the old shape would make
// `createSignedUrl` reject and crash the page. Returning null on any
// signing failure falls back to the initials placeholder — exactly the
// same fallback used when no logo has been uploaded yet.
export async function getBrandingImageUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  try {
    return await signedUrl(path, BRANDING_URL_TTL_SEC);
  } catch (e) {
    console.warn("[storage] getBrandingImageUrl failed for path:", path, e);
    return null;
  }
}

// For logos embedded in outgoing emails. Same image, but signed for the
// long-tail email-open window — see BRANDING_URL_EMAIL_TTL_SEC.
// Same fail-soft contract as getBrandingImageUrl.
export async function getBrandingImageUrlForEmail(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  try {
    return await signedUrl(path, BRANDING_URL_EMAIL_TTL_SEC);
  } catch (e) {
    console.warn(
      "[storage] getBrandingImageUrlForEmail failed for path:",
      path,
      e,
    );
    return null;
  }
}

export async function convertHeicToJpeg(
  input: ArrayBuffer | Buffer,
): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  const buffer =
    input instanceof Buffer ? input : Buffer.from(new Uint8Array(input));
  // Bound the conversion time. heic-convert can hang on adversarial inputs
  // (huge declared dimensions), and we don't want to hold the request open
  // for the full maxDuration.
  const convertPromise = convert({
    buffer: buffer as unknown as ArrayBufferLike,
    format: "JPEG",
    quality: 0.9,
  }) as Promise<ArrayBufferLike | Buffer>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("heic_convert_timeout")), 15_000);
  });
  const out = await Promise.race([convertPromise, timeoutPromise]);
  return Buffer.from(out as ArrayBufferLike);
}

export async function uploadObject(opts: {
  path: string;
  body: Buffer | ArrayBuffer | Uint8Array;
  contentType: string;
  // Overwrite an existing object at this path (default false). The bulk-download
  // export reuses one path per engagement, so it upserts.
  upsert?: boolean;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(opts.path, opts.body, {
      contentType: opts.contentType,
      upsert: opts.upsert ?? false,
    });
  if (error) throw error;
}

// `download`, when set, makes the signed URL serve the object with
// Content-Disposition: attachment; filename="<download>" — so navigating the
// browser to it downloads (with the right name) instead of rendering. Required
// for the bulk-download zip, which the client opens via window.location.
export async function signedUrl(
  path: string,
  ttlSec = 900,
  download?: string,
): Promise<string> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSec, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("signed_url_failed");
  return data.signedUrl;
}
