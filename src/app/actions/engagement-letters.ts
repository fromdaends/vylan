"use server";

// Setting up the firm's engagement letter (migration 1580) — upload one PDF
// per language, replace it, remove it.
//
// Gated on the firm.settings capability, the same rule the service catalogue
// uses: what the firm sends every client to sign is firm configuration, not
// something anyone holding an engagement should change. RLS scopes the write
// to the firm; this decides who inside it may act.

import { nanoid } from "nanoid";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";
import {
  deleteFirmLetter,
  listFirmLetters,
  upsertFirmLetter,
  type LetterLocale,
} from "@/lib/db/engagement-letters";
import {
  MAX_BYTES,
  engagementLetterPath,
  truncateFilename,
  uploadObject,
} from "@/lib/storage";

export type LetterActionState =
  | { ok: true }
  | {
      ok: false;
      error:
        | "no_session"
        | "not_allowed"
        | "invalid_locale"
        | "file_missing"
        | "file_type"
        | "file_size"
        | "save_failed";
    };

function parseLocale(v: unknown): LetterLocale | null {
  return v === "en" || v === "fr" ? v : null;
}

export async function uploadEngagementLetterAction(
  formData: FormData,
): Promise<LetterActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  if (!can(user, "firm.settings")) return { ok: false, error: "not_allowed" };

  const locale = parseLocale(formData.get("locale"));
  if (!locale) return { ok: false, error: "invalid_locale" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "file_missing" };
  }
  // SignWell signs PDFs, so anything else would fail later, at send time, on
  // a client's engagement — refuse it here where somebody is watching.
  if (file.type !== "application/pdf") return { ok: false, error: "file_type" };
  if (file.size > MAX_BYTES) return { ok: false, error: "file_size" };

  const fileName = truncateFilename(file.name);
  const path = engagementLetterPath({
    firmId: user.firm_id,
    locale,
    uuid: nanoid(12),
    filename: fileName,
  });

  try {
    await uploadObject({
      path,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: "application/pdf",
    });
    await upsertFirmLetter({
      firmId: user.firm_id,
      locale,
      storagePath: path,
      fileName,
      uploadedBy: user.id,
    });
  } catch (e) {
    console.error("[engagement-letters] upload failed:", e);
    return { ok: false, error: "save_failed" };
  }

  await logUserActivity(user.firm_id, null, "engagement_letter_set", {
    locale,
    file_name: fileName,
  });
  revalidateAllLocales("/vylan");
  return { ok: true };
}

export async function removeEngagementLetterAction(
  formData: FormData,
): Promise<LetterActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  if (!can(user, "firm.settings")) return { ok: false, error: "not_allowed" };

  const locale = parseLocale(formData.get("locale"));
  if (!locale) return { ok: false, error: "invalid_locale" };

  try {
    // The row goes; the OBJECT stays. Engagements that already sent this
    // letter hold their own copy, but a stored object nobody points at is
    // cheap, and deleting bytes a signature request might still be reading is
    // the one mistake here that cannot be undone.
    await deleteFirmLetter(user.firm_id, locale);
  } catch (e) {
    console.error("[engagement-letters] remove failed:", e);
    return { ok: false, error: "save_failed" };
  }

  await logUserActivity(user.firm_id, null, "engagement_letter_removed", {
    locale,
  });
  revalidateAllLocales("/vylan");
  return { ok: true };
}

/** For the setup card: which languages currently have a letter. */
export async function getEngagementLetterSummary(): Promise<
  { locale: LetterLocale; fileName: string; uploadedAt: string }[]
> {
  try {
    const letters = await listFirmLetters();
    return letters.map((l) => ({
      locale: l.locale,
      fileName: l.fileName,
      uploadedAt: l.uploadedAt,
    }));
  } catch {
    return [];
  }
}
