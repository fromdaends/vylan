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
  deleteServiceLetter,
  listFirmLetters,
  listServiceLetters,
  upsertServiceLetter,
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
        | "invalid_service"
        | "file_missing"
        | "file_type"
        | "file_size"
        | "save_failed";
    };

function parseLocale(v: unknown): LetterLocale | null {
  return v === "en" || v === "fr" ? v : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseServiceId(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export async function uploadEngagementLetterAction(
  formData: FormData,
): Promise<LetterActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  if (!can(user, "firm.settings")) return { ok: false, error: "not_allowed" };

  const locale = parseLocale(formData.get("locale"));
  if (!locale) return { ok: false, error: "invalid_locale" };
  const serviceId = parseServiceId(formData.get("service_id"));
  if (!serviceId) return { ok: false, error: "invalid_service" };

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
    serviceId,
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
    await upsertServiceLetter({
      firmId: user.firm_id,
      serviceId,
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
    service_id: serviceId,
    locale,
    file_name: fileName,
  });
  revalidateAllLocales("/templates/services");
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
  const serviceId = parseServiceId(formData.get("service_id"));
  if (!serviceId) return { ok: false, error: "invalid_service" };

  try {
    // The row goes; the OBJECT stays. Engagements that already sent this
    // letter hold their own copy, but a stored object nobody points at is
    // cheap, and deleting bytes a signature request might still be reading is
    // the one mistake here that cannot be undone.
    await deleteServiceLetter(serviceId, locale);
  } catch (e) {
    console.error("[engagement-letters] remove failed:", e);
    return { ok: false, error: "save_failed" };
  }

  await logUserActivity(user.firm_id, null, "engagement_letter_removed", {
    service_id: serviceId,
    locale,
  });
  revalidateAllLocales("/templates/services");
  return { ok: true };
}

/** One service's letters, for its builder. */
export async function getServiceLetterSummary(
  serviceId: string,
): Promise<{ locale: LetterLocale; fileName: string; uploadedAt: string }[]> {
  if (!parseServiceId(serviceId)) return [];
  try {
    const letters = await listServiceLetters(serviceId);
    return letters.map((l) => ({
      locale: l.locale,
      fileName: l.fileName,
      uploadedAt: l.uploadedAt,
    }));
  } catch {
    return [];
  }
}

/** Which services have a letter at all — for the catalogue list. */
export async function getServiceIdsWithLetters(): Promise<string[]> {
  try {
    return [...new Set((await listFirmLetters()).map((l) => l.serviceId))];
  } catch {
    return [];
  }
}
