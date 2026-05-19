"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm, updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getPathname } from "@/i18n/navigation";
import { parseEmailList } from "@/lib/validators";
import { buildWelcomeEmail, sendEmail } from "@/lib/email";
import { seedDemoData } from "@/lib/demo-seed";

export type OnboardingState = {
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const Step1Schema = z.object({
  firm_name: z.string().min(2, "min_2_chars").max(120, "too_long"),
  brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "invalid_color")
    .default("#1e293b"),
});

const Step2Schema = z.object({
  timezone: z.string().min(2, "required"),
  locale_default: z.enum(["fr", "en"]),
});

const Step3Schema = z.object({
  emails: z.string().optional().default(""),
});

function pickLocale(formData: FormData): "fr" | "en" {
  const v = formData.get("locale");
  return v === "en" ? "en" : "fr";
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function localPath(
  locale: "fr" | "en",
  pathname: string,
  query?: Record<string, string>,
): string {
  return getPathname({ locale, href: { pathname, query } });
}

export async function submitStep1(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step1Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const locale = pickLocale(formData);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "no_session" };

  const userMetaName =
    (auth.user.user_metadata?.name as string | undefined)?.trim() ||
    auth.user.email!.split("@")[0];
  const userMetaLocale =
    auth.user.user_metadata?.locale === "en" ? "en" : "fr";

  const existingFirm = await getCurrentFirm();

  if (!existingFirm) {
    // Use service-role client: migration 0009 removed permissive INSERT
    // policies on `firms` and `users`, so first-time onboarding must bypass
    // RLS through the server-side service-role path.
    const admin = getServiceRoleSupabase();
    // Every firm created from the public signup flow is a demo until
    // the founder converts it manually. Existing firms keep is_demo
    // = false from the migration default.
    const { data: firm, error: firmErr } = await admin
      .from("firms")
      .insert({
        name: parsed.data.firm_name,
        brand_color: parsed.data.brand_color,
        locale_default: userMetaLocale,
        plan: "trial",
        is_demo: true,
      })
      .select("id")
      .single();
    if (firmErr || !firm) {
      return { error: "create_failed" };
    }

    const { error: userErr } = await admin.from("users").insert({
      id: auth.user.id,
      firm_id: firm.id,
      email: auth.user.email!,
      name: userMetaName,
      role: "owner",
      locale: userMetaLocale,
    });
    if (userErr) {
      return { error: "create_failed" };
    }

    // Seed demo data so the dashboard / clients / engagements pages
    // have something realistic on first visit. Best-effort: a failed
    // seed shouldn't block onboarding from completing.
    after(async () => {
      try {
        await seedDemoData(admin, firm.id);
      } catch (e) {
        console.error("[onboarding] demo seed failed:", e);
      }
    });
  } else {
    await updateCurrentFirm({
      name: parsed.data.firm_name,
      brand_color: parsed.data.brand_color,
    });
  }

  revalidatePath("/", "layout");
  redirect(localPath(locale, "/onboarding", { step: "2" }));
}

export async function submitStep2(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step2Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  await updateCurrentFirm({
    timezone: parsed.data.timezone,
    locale_default: parsed.data.locale_default,
  });
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/onboarding", { step: "3" }));
}

export async function submitStep3(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step3Schema.safeParse({
    emails: formData.get("emails") ?? "",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const emails = parseEmailList(parsed.data.emails);
  await updateCurrentFirm({
    invited_emails: emails,
    onboarded_at: new Date().toISOString(),
  });
  await sendWelcomeEmail();
  revalidatePath("/", "layout");
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/dashboard"));
}

async function sendWelcomeEmail(): Promise<void> {
  // Fire-and-forget: don't block onboarding redirect on a slow Resend call.
  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user?.email || !firm) return;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { subject, html, text } = buildWelcomeEmail({
    firmName: firm.name,
    ownerName: user.name || user.email.split("@")[0],
    appUrl,
    locale: firm.locale_default,
  });
  after(async () => {
    try {
      await sendEmail({ to: user.email, subject, html, text });
    } catch (e) {
      console.error("[welcome email] failed:", e);
    }
  });
}

export async function skipStep(formData: FormData) {
  const step = Number(formData.get("step")) as 1 | 2 | 3;
  const locale = pickLocale(formData);

  if (step >= 3) {
    await updateCurrentFirm({ onboarded_at: new Date().toISOString() });
    await sendWelcomeEmail();
    revalidatePath("/", "layout");
    redirect(localPath(locale, "/dashboard"));
  }
  redirect(localPath(locale, "/onboarding", { step: String(step + 1) }));
}
