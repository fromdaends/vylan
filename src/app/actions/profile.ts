"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateUserProfile } from "@/lib/db/users";
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
        | "same_email";
    };

const DisplayNameSchema = z.object({
  display_name: z.string().max(80).optional().nullable(),
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
  revalidatePath("/profile", "layout");
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
