"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  checkRateLimit,
  LOGIN_LIMIT,
  SIGNUP_LIMIT,
  PASSWORD_RESET_LIMIT,
} from "@/lib/rate-limit";

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "min_8_chars"),
});

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "min_8_chars"),
  name: z.string().min(2, "min_2_chars"),
  locale: z.enum(["fr", "en"]).default("fr"),
});

const ForgotSchema = z.object({
  email: z.string().email(),
});

const ResetSchema = z.object({
  password: z.string().min(8, "min_8_chars"),
});

function localPath(locale: "fr" | "en", pathname: string): string {
  return getPathname({ locale, href: pathname });
}

function pickLocale(formData: FormData): "fr" | "en" {
  const raw = formData.get("locale");
  return raw === "en" ? "en" : "fr";
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `login:ip:${ip}`,
    ...LOGIN_LIMIT,
  });
  if (!rl.ok) {
    return { error: "rate_limited" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: "invalid_credentials" };
  }
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/dashboard"));
}

export async function signupAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = SignupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `signup:ip:${ip}`,
    ...SIGNUP_LIMIT,
  });
  if (!rl.ok) {
    return { error: "rate_limited" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name, locale: parsed.data.locale },
    },
  });
  if (error) {
    if (error.message.toLowerCase().includes("registered")) {
      return { error: "email_taken" };
    }
    return { error: "signup_failed" };
  }
  redirect(localPath(parsed.data.locale, "/onboarding"));
}

export async function logoutAction() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(localPath(routing.defaultLocale, "/login"));
}

export async function forgotPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = ForgotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `pwreset:ip:${ip}`,
    ...PASSWORD_RESET_LIMIT,
  });
  if (!rl.ok) {
    // Still return reset_sent — don't reveal whether the limiter tripped or
    // whether the email exists. The cap silently drops further attempts.
    return { error: "reset_sent" };
  }
  const supabase = await getServerSupabase();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}/api/auth/callback?next=/reset-password`,
  });
  // Intentionally do not reveal whether the email exists.
  return { error: "reset_sent" };
}

export async function resetPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = ResetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: "reset_failed" };
  }
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/dashboard"));
}
