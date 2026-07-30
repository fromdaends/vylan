// Upload limits and the accepted file types — in a NEUTRAL module.
//
// These values used to live only in lib/storage.ts, which imports
// getServiceRoleSupabase and therefore next/headers. Importing a single
// constant from there into a client component drags the whole server module
// into the browser bundle and the page dies with:
//
//   "You're importing a module that depends on next/headers"
//
// That is the mirror image of the footgun already documented in this codebase
// (a constant exported from a "use client" file becoming a stub in a Server
// Component). Same lesson, opposite direction: SHARED VALUES BELONG IN A
// MODULE THAT IMPORTS NEITHER SIDE.
//
// lib/storage.ts re-exports these so no existing caller changes.

/** Per-file ceiling. */
export const MAX_BYTES = 25 * 1024 * 1024;

/**
 * What the storage bucket actually accepts. Anything else is REJECTED by
 * Supabase at write time, which is why the import wizard checks against this
 * list up front and names the files it cannot take — a firm's historical
 * folders are full of .docx and .xlsx, and silently dropping them would mean
 * believing you imported ten years of work when you imported half of it.
 */
export const HEIC_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  ...HEIC_MIMES,
]);

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime.toLowerCase());
}

export function isHeic(mime: string): boolean {
  return HEIC_MIMES.has(mime.toLowerCase());
}
