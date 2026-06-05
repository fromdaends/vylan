"use client";

// Blue glassmorphic sign-up — matches the public marketing site and the
// /login page (the "Tell us about your firm" lead form). Reuses the landing's
// .vy-* classes (blue background, glass card, translucent fields, white CTA)
// from vylan-landing.css + the Schibsted Grotesk face, on a fixed full-bleed
// layer so it covers the shared (auth) layout's dark chrome.
//
// On success the server action returns { checkEmail, email } (email
// confirmation is enabled), so instead of redirecting we swap the form for a
// "check your email" view — the confirmation link then lands the user signed
// in, in onboarding.

import "@/styles/vylan-landing.css";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { signupAction, type AuthActionState } from "@/app/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { schibsted } from "@/components/vylan-landing/fonts";
import { brand } from "@/lib/brand";
import { ArrowRight, Mail } from "lucide-react";

export default function SignupPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const localeNarrow: "fr" | "en" = locale === "en" ? "en" : "fr";
  // `?continue=onboarding` is still carried into the Google OAuth button (that
  // path keeps its own funnel handling). The email signup sets its own
  // post-confirmation destination server-side.
  const searchParams = useSearchParams();
  const continueParam = searchParams.get("continue") ?? "";
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(signupAction, null);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className={`vy-root ${schibsted.variable}`}>
        <div className="mx-auto max-w-md px-6 pb-16 pt-9">
          {/* Brand */}
          <div className="mb-7 flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[22px] font-semibold tracking-[-0.04em] text-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/vylan-logo-white.png"
                alt={brand.name}
                className="h-6 w-6"
              />
              {brand.name}
            </Link>
          </div>

          {/* Card */}
          <div className="vy-form-card" style={{ width: "100%" }}>
            <div className="vy-glow" />
            <span className="vy-spark" aria-hidden>
              ✦
            </span>

            {state?.checkEmail ? (
              /* Confirmation pending — the account was created, the user just
                 needs to click the email link to activate + sign in. */
              <div className="text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white">
                  <Mail className="h-7 w-7" aria-hidden />
                </div>
                <h2>{t("check_email_title")}</h2>
                <p className="vy-form-sub">
                  {t("check_email_body", { email: state.email ?? "" })}
                </p>
                <p className="mt-4 text-sm text-white/60">
                  {t("check_email_spam")}
                </p>
                <p className="mt-6 text-center text-sm text-white/75">
                  <Link
                    href="/login"
                    className="font-semibold text-white underline-offset-4 hover:underline"
                  >
                    {t("check_email_back")}
                  </Link>
                </p>
              </div>
            ) : (
              <>
                <h2>{t("signup_title")}</h2>
                <p className="vy-form-sub">{t("signup_subtitle")}</p>

                <div className="vy-fields">
                  <GoogleSignInButton
                    locale={localeNarrow}
                    label={t("continue_with_google")}
                    continueParam={continueParam}
                    className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  />

                  <div className="flex items-center gap-3" aria-hidden>
                    <span className="h-px flex-1 bg-white/20" />
                    <span className="text-xs uppercase tracking-wider text-white/55">
                      {t("or_divider")}
                    </span>
                    <span className="h-px flex-1 bg-white/20" />
                  </div>

                  {state?.error && (
                    <div className="vy-form-err" role="alert">
                      {t(`errors.${state.error}` as const)}
                    </div>
                  )}

                  <form action={formAction} className="flex flex-col gap-3.5">
                    <input type="hidden" name="locale" value={locale} />
                    <div>
                      <input
                        className={
                          "vy-field" +
                          (state?.fieldErrors?.name ? " vy-invalid" : "")
                        }
                        name="name"
                        type="text"
                        autoComplete="name"
                        placeholder={t("name")}
                        aria-label={t("name")}
                        required
                      />
                      {state?.fieldErrors?.name && (
                        <p className="mt-1.5 text-xs text-white/90">
                          {t(`errors.${state.fieldErrors.name}` as const)}
                        </p>
                      )}
                    </div>

                    <div>
                      <input
                        className={
                          "vy-field" +
                          (state?.fieldErrors?.email ? " vy-invalid" : "")
                        }
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder={t("email")}
                        aria-label={t("email")}
                        required
                      />
                      {state?.fieldErrors?.email && (
                        <p className="mt-1.5 text-xs text-white/90">
                          {t(`errors.${state.fieldErrors.email}` as const)}
                        </p>
                      )}
                    </div>

                    <div>
                      <input
                        className={
                          "vy-field" +
                          (state?.fieldErrors?.password ? " vy-invalid" : "")
                        }
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={t("password")}
                        aria-label={t("password")}
                        minLength={8}
                        required
                      />
                      {state?.fieldErrors?.password && (
                        <p className="mt-1.5 text-xs text-white/90">
                          {t(`errors.${state.fieldErrors.password}` as const)}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={pending}
                      className="vy-submit mt-1 inline-flex w-full items-center justify-center gap-2"
                    >
                      {pending ? tc("loading") : t("submit_signup")}
                      {!pending && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </form>
                </div>

                <p className="mt-6 text-center text-sm text-white/75">
                  {t("have_account")}{" "}
                  <Link
                    href="/login"
                    className="font-semibold text-white underline-offset-4 hover:underline"
                  >
                    {t("sign_in")}
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
