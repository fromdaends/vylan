"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateUserProfile, getCurrentUser } from "@/lib/db/users";
import { updateCurrentFirm } from "@/lib/db/firms";
import { uploadBrandingImage } from "@/app/actions/branding";

export type ProfileActionResult =
  | { ok: true; signedUrl?: string }
  | {
      ok: false;
      error:
        | "unauth"
        | "invalid"
        | "save_failed"
        | "missing_password"
        | "wrong_password"
        | "weak_password"
        | "upload_failed"
        | "email_taken"
        | "same_email"
        | "owner_only";
    };

const DisplayNameSchema = z.object({
  display_name: z.string().max(80).optional().nullable(),
});

// Your role at the firm: what you do, and how much of a week you have.
//
// BOTH ARE YOURS TO SET. The firm owner reads them on your teammate page and
// plans capacity with them, but the founder's call is that nobody else edits
// them — a job title somebody assigned you without asking is a strange thing
// for a product to enable, and hours you did not agree to are worse.
//
// 168 is the number of hours in a week. A capacity figure outside that is a
// typo, and it is the denominator every future workload number divides by, so
// it is refused rather than stored. Matches the database's check constraint.
const WorkDetailsSchema = z.object({
  job_title: z.string().max(120).optional().nullable(),
  weekly_hours: z.number().positive().max(168).optional().nullable(),
});

const LocaleSchema = z.object({
  locale: z.enum(["fr", "en"]),
});

const EmailSchema = z.object({
  email: z.string().email().max(254),
});

const PasswordSchema = z.object({
  current_password: z.string().min(8),
  new_password: z.string().min(8),
});

async function requireAuth() {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function updateDisplayNameAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  const raw = formData.get("display_name");
  const parsed = DisplayNameSchema.safeParse({
    display_name:
      typeof raw === "string" ? (raw.trim() === "" ? null : raw.trim()) : null,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    await updateUserProfile({ display_name: parsed.data.display_name ?? null });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  // Your name shows across the whole app (sidebar, roster, assignee, comments,
  // activity), so invalidate the ROOT layout — not just /profile — so every
  // surface re-resolves it. The client also router.refresh()es for an instant
  // update on the page you're on.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateWorkDetailsAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  const rawTitle = formData.get("job_title");
  const rawHours = formData.get("weekly_hours");

  const title =
    typeof rawTitle === "string" && rawTitle.trim() !== ""
      ? rawTitle.trim()
      : null;

  // An empty field means "not recorded", which is a real answer and the one
  // everybody starts on. Only a non-empty value has to parse as a number.
  let hours: number | null = null;
  if (typeof rawHours === "string" && rawHours.trim() !== "") {
    // A comma decimal is what a French keyboard produces, and rejecting "22,5"
    // as invalid would be a bug half this app's users would hit first.
    const n = Number(rawHours.trim().replace(",", "."));
    if (!Number.isFinite(n)) return { ok: false, error: "invalid" };
    // Two decimals: a 22.5-hour contract is as common as a 20-hour one, and
    // rounding somebody's week is how a capacity figure stops being trusted.
    hours = Math.round(n * 100) / 100;
  }

  const parsed = WorkDetailsSchema.safeParse({
    job_title: title,
    weekly_hours: hours,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    await updateUserProfile({
      job_title: parsed.data.job_title ?? null,
      weekly_hours: parsed.data.weekly_hours ?? null,
    });
  } catch {
    // Before migration 1190 the columns do not exist and the update throws.
    // Reported as a save failure rather than crashing the page — the rest of
    // the profile keeps working.
    return { ok: false, error: "save_failed" };
  }

  // Your job title shows on your teammate page and beside your name; the
  // roster reads the same row. Invalidate the root layout so every surface
  // re-resolves it rather than showing two different answers.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateLocaleAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  const parsed = LocaleSchema.safeParse({ locale: formData.get("locale") });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    await updateUserProfile({ locale: parsed.data.locale });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath("/profile", "layout");
  return { ok: true };
}

// Email change goes through Supabase auth so the user gets the
// standard "Confirm your new email" link sent to the new address.
// Their auth.users.email only flips once they click that link;
// our users.email is reconciled by getCurrentUser the next time
// they hit the app post-confirmation. Until then, both rows still
// reflect the old email and the customer keeps logging in with it.
export async function updateEmailAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  const raw = formData.get("email");
  const parsed = EmailSchema.safeParse({
    email: typeof raw === "string" ? raw.trim().toLowerCase() : "",
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (parsed.data.email === user.email?.toLowerCase()) {
    return { ok: false, error: "same_email" };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email });
  if (error) {
    // Supabase returns this for emails already on another account.
    const msg = error.message?.toLowerCase() ?? "";
    if (
      msg.includes("already") ||
      msg.includes("taken") ||
      msg.includes("registered")
    ) {
      return { ok: false, error: "email_taken" };
    }
    console.error("[updateEmailAction] auth.updateUser failed:", error);
    return { ok: false, error: "save_failed" };
  }
  // Don't touch users.email yet — that gets reconciled in
  // getCurrentUser after the user confirms via the email link.
  // revalidating /profile keeps the displayed email accurate on the
  // next render (still the old one, until confirmed).
  revalidatePath("/profile", "layout");
  return { ok: true };
}

export async function updateAvatarAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  // Hand off to the Phase 1 branding pipeline (auth + size + decode + sharp).
  const upload = await uploadBrandingImage(formData, "user_avatar");
  if (!upload.ok) {
    if (upload.error === "unauth") return { ok: false, error: "unauth" };
    return { ok: false, error: "upload_failed" };
  }

  try {
    await updateUserProfile({ avatar_path: upload.path });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath("/profile", "layout");
  return { ok: true, signedUrl: upload.signedUrl };
}

export async function removeAvatarAction(): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  try {
    // Clear the path on the user row. We intentionally do NOT delete the
    // underlying storage object — keeping it is cheap and useful for
    // debugging / audit. A future cleanup task can sweep orphaned avatars.
    await updateUserProfile({ avatar_path: null });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath("/profile", "layout");
  return { ok: true };
}

export async function updateFirmLogoAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };
  // Owner-only: the firm logo is firm branding, not a personal setting.
  const me = await getCurrentUser();
  if (me?.role !== "owner") return { ok: false, error: "owner_only" };

  const upload = await uploadBrandingImage(formData, "firm_logo");
  if (!upload.ok) {
    if (upload.error === "unauth") return { ok: false, error: "unauth" };
    return { ok: false, error: "upload_failed" };
  }

  try {
    await updateCurrentFirm({ logo_url: upload.path });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath("/profile", "layout");
  return { ok: true, signedUrl: upload.signedUrl };
}

export async function removeFirmLogoAction(): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };
  // Owner-only: the firm logo is firm branding, not a personal setting.
  const me = await getCurrentUser();
  if (me?.role !== "owner") return { ok: false, error: "owner_only" };

  try {
    await updateCurrentFirm({ logo_url: null });
  } catch {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath("/profile", "layout");
  return { ok: true };
}

export async function changePasswordAction(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireAuth();
  if (!user) return { ok: false, error: "unauth" };

  const parsed = PasswordSchema.safeParse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
  });
  if (!parsed.success) {
    // Distinguish "too short" so the UI can show a helpful message.
    const issues = parsed.error.issues;
    if (issues.some((i) => i.path.includes("new_password"))) {
      return { ok: false, error: "weak_password" };
    }
    return { ok: false, error: "missing_password" };
  }

  const supabase = await getServerSupabase();

  // Re-verify the current password via signInWithPassword. Supabase doesn't
  // require this for updateUser, but verifying defends against a hijacked
  // session changing the password silently.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: parsed.data.current_password,
  });
  if (verifyErr) {
    return { ok: false, error: "wrong_password" };
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  });
  if (updateErr) {
    return { ok: false, error: "save_failed" };
  }
  return { ok: true };
}
