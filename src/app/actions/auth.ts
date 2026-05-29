"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
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

// Marker cookie that the SSR middleware reads to decide whether to
// preserve session-only behaviour on every Supabase token rotation.
// Itself session-only (no maxAge / expires).
const REMEMBER_OFF_COOKIE = "vylan-session-only";

async function applyRememberMePreference(remember: boolean): Promise<void> {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";

  if (remember) {
    // Remembered. Clear the marker if a prior session set it. Cookies
    // Supabase just issued already use the SDK's persistent default —
    // nothing to override.
    cookieStore.delete(REMEMBER_OFF_COOKIE);
    return;
  }

  // Not remembered. Drop the marker so the middleware strips maxAge
  // on future rotations, then re-set the auth cookies as session-
  // only right now.
  cookieStore.set({
    name: REMEMBER_OFF_COOKIE,
    value: "1",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    // no maxAge / expires → session cookie
  });

  for (const c of cookieStore.getAll()) {
    if (!c.name.startsWith("sb-")) continue;
    cookieStore.set({
      name: c.name,
      value: c.value,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      // no maxAge / expires → session cookie
    });
  }
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

  // "Remember me" handling. Default = checked = persistent (Supabase's
  // 30-day refresh). When the user unticks the box we convert the
  // freshly-set auth cookies into session-only ones (no maxAge /
  // expires) AND drop a marker cookie so the middleware does the same
  // thing on every subsequent token rotation. Without the marker the
  // next refresh would re-set the cookies as persistent again.
  await applyRememberMePreference(formData.get("remember_me") === "on");

  const locale = pickLocale(formData);
  // If the user has MFA enrolled, send them to the challenge page first.
  // The app layout enforces the same rule as a backstop for any other
  // entry path (deep links, refresh on a stale aal1 cookie, etc.).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(localPath(locale, "/login/mfa"));
  }
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
    // Log enough context to debug the "Couldn't create the account"
    // generic without leaking the password itself. Supabase Auth
    // returns error.code (newer SDKs) plus a human-readable message;
    // both go in for whichever the SDK supplies on the day.
    console.error("[auth.signup] supabase.auth.signUp failed", {
      message: error.message,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      emailDomain: parsed.data.email.split("@")[1],
    });
    const msg = error.message.toLowerCase();
    const code = (error as { code?: string }).code ?? "";
    if (msg.includes("registered") || code === "user_already_exists") {
      return { error: "email_taken" };
    }
    // Detect password-policy rejections by keyword. Supabase returns
    // messages like "Password should contain at least one character of
    // each: lowercase, uppercase, digits…" — covers most variants.
    if (
      msg.includes("password") ||
      code === "weak_password" ||
      code === "validation_failed"
    ) {
      return { error: "weak_password" };
    }
    return { error: "signup_failed" };
  }
  // Funnel discipline: every brand-new account flows through /demo
  // first for qualification (firm size, current tools, etc.). The
  // founder hand-converts qualified leads while billing is gated.
  // This matches the OAuth callback behaviour (see PR #242).
  //
  // Exception: `continue=onboarding` is a soft signal set by /demo's
  // "Try the demo" button — it means the prospect already qualified
  // via the /demo questionnaire and is now self-serving an account.
  // Bouncing them back to /demo would loop. Allowlist a single
  // sanctioned value so a random `?continue=evil` can't bypass.
  const continueRaw = formData.get("continue");
  const continueOk = continueRaw === "onboarding";
  const destination = continueOk ? "/onboarding" : "/demo";
  redirect(localPath(parsed.data.locale, destination));
}

export async function logoutAction() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(localPath(routing.defaultLocale, "/login"));
}

// Google OAuth sign-in (works for both first-time signup and returning
// sign-in — Supabase Auth treats the first OAuth call as account
// creation). The flow:
//   1. We call signInWithOAuth which prepares the PKCE code_verifier
//      cookie on our domain and returns Google's consent URL.
//   2. We redirect the user to that URL. They authenticate with Google.
//   3. Google redirects to Supabase's callback (configured in the
//      Supabase dashboard under Authentication → Providers → Google).
//   4. Supabase exchanges the OAuth grant for a Supabase session and
//      redirects to our /api/auth/callback with `?code=...&next=...`.
//   5. Our callback handler exchanges the code (reads code_verifier
//      cookie) and redirects the user to `next`.
//
// First-time Google users land on /dashboard, where the (app)/layout sees
// no public.users row + no firm and bounces them to /onboarding, which
// asks for firm name + creates the public.users row from the Google
// profile name via the existing step1Action.
export async function signInWithGoogleAction(formData: FormData) {
  const locale = pickLocale(formData);
  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `oauth:google:ip:${ip}`,
    ...LOGIN_LIMIT,
  });
  if (!rl.ok) {
    redirect(localPath(locale, "/login?error=rate_limited"));
  }

  const supabase = await getServerSupabase();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // Mirror the email signupAction's continue-param allowlist. When set
  // to "onboarding" the user already qualified via /demo's "Try the
  // demo" CTA, so we skip the new-user → /demo redirect after the
  // OAuth round-trip. Both the `next` URL and a separate `continue`
  // query param are encoded into redirectTo so the callback handler
  // (which is the one that actually does the routing) sees the signal.
  const continueOk = formData.get("continue") === "onboarding";
  const nextPath = localPath(locale, continueOk ? "/onboarding" : "/dashboard");
  const redirectTo =
    `${appUrl}/api/auth/callback?next=${encodeURIComponent(nextPath)}` +
    (continueOk ? "&continue=onboarding" : "");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // Force the Google account chooser every time. Without this, a
      // user with a single Google session is auto-selected — which is
      // fine for sign-in but jarring on a "create account" intent
      // where they may want to use a different Google identity.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    redirect(localPath(locale, "/login?error=oauth_failed"));
  }

  redirect(data.url);
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
