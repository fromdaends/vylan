"use client";

// Blue glassmorphic login — matches the public marketing site (the "Tell us
// about your firm" lead form). Reuses the landing's .vy-* classes (blue
// background, glass card, translucent fields, white CTA) from vylan-landing.css
// + the Schibsted Grotesk face, on a fixed full-bleed layer so it covers the
// shared (auth) layout's dark chrome. Only the LOOK changed — the form action,
// field names (email / password / remember_me / locale) and flow are identical.

import "@/styles/vylan-landing.css";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { loginAction, type AuthActionState } from "@/app/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { schibsted } from "@/components/vylan-landing/fonts";
import { brand } from "@/lib/brand";
import { ArrowRight } from "lucide-react";

// Allowlist of error codes the login page surfaces from the URL (a stray
// ?error=whatever is ignored so it can't render a missing translation).
const URL_ERROR_CODES = new Set(["callback", "oauth_failed", "rate_limited"]);

export default function LoginPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const localeNarrow: "fr" | "en" = locale === "en" ? "en" : "fr";
  const searchParams = useSearchParams();
  const rawUrlError = searchParams.get("error");
  const urlError =
    rawUrlError && URL_ERROR_CODES.has(rawUrlError) ? rawUrlError : null;
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(loginAction, null);
  // A fresh submit error wins over the URL one (which is from a prior redirect).
  const visibleError = state?.error ?? urlError;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className={`vy-root ${schibsted.variable}`}>
        {/* Block-flow centering (max-width + margin:auto) — reliably full-width,
            unlike a nested-flex item which can shrink-wrap. */}
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

              <h2>{t("login_title")}</h2>
              <p className="vy-form-sub">{t("login_subtitle")}</p>

              <div className="vy-fields">
                <GoogleSignInButton
                  locale={localeNarrow}
                  label={t("continue_with_google")}
                  className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                />

                {/* OR divider — two line segments around the label (no masking
                    needed on the translucent card). */}
                <div className="flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-white/20" />
                  <span className="text-xs uppercase tracking-wider text-white/55">
                    {t("or_divider")}
                  </span>
                  <span className="h-px flex-1 bg-white/20" />
                </div>

                {visibleError && (
                  <div className="vy-form-err" role="alert">
                    {t(`errors.${visibleError}` as const)}
                  </div>
                )}

                <form action={formAction} className="flex flex-col gap-3.5">
                  <input type="hidden" name="locale" value={locale} />
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
                      autoComplete="current-password"
                      placeholder={t("password")}
                      aria-label={t("password")}
                      required
                    />
                    {state?.fieldErrors?.password && (
                      <p className="mt-1.5 text-xs text-white/90">
                        {t(`errors.${state.fieldErrors.password}` as const)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-white/85">
                      <input
                        type="checkbox"
                        name="remember_me"
                        defaultChecked
                        className="size-4 rounded border-white/40 bg-white/10 accent-white"
                      />
                      {t("remember_me")}
                    </label>
                    <Link
                      href="/forgot-password"
                      className="text-sm text-white/70 transition-colors hover:text-white"
                    >
                      {t("forgot_link")}
                    </Link>
                  </div>

                  <button
                    type="submit"
                    disabled={pending}
                    className="vy-submit mt-1 inline-flex w-full items-center justify-center gap-2"
                  >
                    {pending ? tc("loading") : t("submit_login")}
                    {!pending && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>
              </div>

              <p className="mt-6 text-center text-sm text-white/75">
                {t("no_account")}{" "}
                <Link
                  href="/signup"
                  className="font-semibold text-white underline-offset-4 hover:underline"
                >
                  {t("create_account")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
  );
}
