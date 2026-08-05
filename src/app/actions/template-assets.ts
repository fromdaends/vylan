"use server";

// Uploading a file for an engagement template's INTRODUCTION.
//
// Canopy's Introduction rows take an upload, not only a link: their Video row
// accepts a YouTube/Vimeo/Zoom link OR a file, and their Document row is "an
// internal file or an uploaded PDF". The founder, on seeing link-only fields:
// "for the video and document. It should allow for a actual file upload not
// just a link."
//
// Only async exports live here — a `"use server"` module that exports anything
// else fails the production build, and nothing else in the toolchain catches it.

import { nanoid } from "nanoid";
import { getCurrentUser } from "@/lib/db/users";
import {
  templateAssetPath,
  truncateFilename,
  uploadObject,
} from "@/lib/storage";

/** 25 MB. Big enough for a brochure or a short screen recording, small enough
 *  that a stray 4K export is refused here rather than timing out mid-upload. */
const MAX_BYTES = 25 * 1024 * 1024;

// What each row will accept. Deliberately narrow: the file ends up in front of
// a CLIENT, so an executable or an archive has no business being offered.
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
];

export type TemplateAssetResult =
  | { ok: true; path: string; fileName: string }
  | {
      ok: false;
      error: "no_session" | "file_missing" | "file_type" | "file_size" | "failed";
    };

export async function uploadTemplateAssetAction(
  formData: FormData,
): Promise<TemplateAssetResult> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };

  const kind = formData.get("kind");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "file_missing" };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "file_size" };

  // Checked against the ROW that asked, not one combined list: a video file in
  // the Document row would play nowhere, and a PDF in the Video row would sit
  // behind a play button that does nothing.
  const allowed = kind === "video" ? VIDEO_TYPES : DOCUMENT_TYPES;
  if (!allowed.includes(file.type)) return { ok: false, error: "file_type" };

  const fileName = truncateFilename(file.name);
  const path = templateAssetPath({
    firmId: user.firm_id,
    uuid: nanoid(12),
    filename: fileName,
  });

  try {
    await uploadObject({
      path,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
  } catch (e) {
    console.error("[template-assets] upload failed:", e);
    return { ok: false, error: "failed" };
  }

  // The PATH goes back to the form, which stores it in the template's payload
  // when the template is saved. An upload the user then abandons leaves an
  // orphaned object rather than a broken template — the safer of the two.
  return { ok: true, path, fileName };
}
