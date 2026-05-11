import { getServiceRoleSupabase } from "@/lib/supabase/server";

export const BUCKET = "client-uploads";
export const MAX_BYTES = 25 * 1024 * 1024;

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
  const out = (await convert({
    buffer: buffer as unknown as ArrayBufferLike,
    format: "JPEG",
    quality: 0.9,
  })) as ArrayBufferLike | Buffer;
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
