import { getServiceRoleSupabase } from "@/lib/supabase/server";

export const BUCKET = "client-uploads";
export const MAX_BYTES = 25 * 1024 * 1024;
// HEIC decoder allocates `width * height * 4` bytes during decode, so a small
// file with crafted dimensions can OOM the runtime. Real iPhone HEIC photos
// are under 5 MB; cap below the general limit as a defense.
export const MAX_HEIC_INPUT_BYTES = 10 * 1024 * 1024;
// Maximum filename length stored in the DB / used in storage keys. Long names
// can break ICU message rendering and bloat rows.
export const MAX_FILENAME_LEN = 200;

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

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  ...HEIC_MIMES,
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
  const safeName = parts.filename
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/items/${parts.itemId}/${parts.uuid}-${safeName}`;
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
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(opts.path, opts.body, {
      contentType: opts.contentType,
      upsert: false,
    });
  if (error) throw error;
}

export async function signedUrl(path: string, ttlSec = 900): Promise<string> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSec);
  if (error || !data) throw error ?? new Error("signed_url_failed");
  return data.signedUrl;
}
