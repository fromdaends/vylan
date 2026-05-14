"use server";

import { nanoid } from "nanoid";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  BRANDING_OUTPUT_SIZE,
  MAX_BRANDING_BYTES,
  MAX_BRANDING_HARD_LIMIT,
  brandingStoragePath,
  getBrandingImageUrl,
  uploadObject,
  type BrandingKind,
} from "@/lib/storage";
import {
  ImageProcessError,
  isAcceptedBrandingMime,
  processImageUpload,
} from "@/lib/images";

const KindSchema = z.enum(["firm_logo", "user_avatar"]);

export type BrandingUploadResult =
  | { ok: true; signedUrl: string; path: string }
  | {
      ok: false;
      error:
        | "unauth"
        | "no_firm"
        | "bad_kind"
        | "missing_file"
        | "bad_mime"
        | "too_large"
        | "process_failed"
        | "upload_failed";
    };

/**
 * Upload a firm logo or user avatar.
 *
 * Server action contract:
 * - `formData.get("file")` — the binary File (multipart form).
 * - The `kind` arg comes from the trusted call site, not the form, so a
 *   malicious caller can't pretend a user avatar is a firm logo.
 *
 * Auth: caller must be signed in AND a member of a firm. No fancy roles —
 * any firm member can update the firm logo. Avatars are scoped to the
 * caller's own user_id, even when `kind` is `user_avatar`.
 *
 * Returns the signed URL + storage path; phases 2/3 will persist the path
 * to the appropriate DB column.
 */
export async function uploadBrandingImage(
  formData: FormData,
  kind: BrandingKind,
): Promise<BrandingUploadResult> {
  const parsedKind = KindSchema.safeParse(kind);
  if (!parsedKind.success) return { ok: false, error: "bad_kind" };

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "unauth" };

  const [firm, user] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
  ]);
  if (!firm || !user) return { ok: false, error: "no_firm" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "missing_file" };

  // Hard-reject memory-bomb uploads before any decoder touches them.
  if (file.size > MAX_BRANDING_HARD_LIMIT) {
    return { ok: false, error: "too_large" };
  }
  if (!isAcceptedBrandingMime(file.type)) {
    return { ok: false, error: "bad_mime" };
  }

  let buf: Buffer;
  try {
    buf = await processImageUpload(file, {
      maxBytes: MAX_BRANDING_BYTES,
      outputSize: BRANDING_OUTPUT_SIZE,
    });
  } catch (e) {
    if (e instanceof ImageProcessError) {
      if (e.code === "too_large") return { ok: false, error: "too_large" };
      if (e.code === "bad_mime") return { ok: false, error: "bad_mime" };
      return { ok: false, error: "process_failed" };
    }
    return { ok: false, error: "process_failed" };
  }

  const path = brandingStoragePath({
    firmId: firm.id,
    kind: parsedKind.data,
    userId: parsedKind.data === "user_avatar" ? user.id : undefined,
    uuid: nanoid(12),
    ext: "jpg",
  });

  try {
    await uploadObject({
      path,
      body: buf,
      contentType: "image/jpeg",
    });
  } catch (e) {
    console.error("[branding] uploadObject failed:", e);
    return { ok: false, error: "upload_failed" };
  }

  const url = await getBrandingImageUrl(path);
  if (!url) return { ok: false, error: "upload_failed" };
  return { ok: true, signedUrl: url, path };
}
