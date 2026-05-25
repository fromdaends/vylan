"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction, type AuthActionState } from "@/app/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { ArrowRight } from "lucide-react";

// Allowlist of error codes the login page knows how to surface from
// the URL. Anything else gets ignored so a stray ?error=whatever
// doesn't try to render a missing translation.
const URL_ERROR_CODES = new Set([
  "callback",
  "oauth_failed",
  "rate_limited",
]);

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
  // Form-submit error takes precedence over the URL one — the URL
  // error is from a prior redirect (OAuth failure, expired link, etc.)
  // and we don't want to keep showing it after the user has tried again.
  const visibleError = state?.error ?? urlError;

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("login_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("login_subtitle")}
        </p>
      </div>

      <GoogleSignInButton
        locale={localeNarrow}
        label={t("continue_with_google")}
      />

      <div className="relative my-5" aria-hidden>
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-background px-2 text-muted-foreground">
            {t("or_divider")}
          </span>
        </div>
      </div>

      {visibleError && (
        <Alert variant="destructive" className="animate-in-fade mb-4">
          <AlertDescription>
            {t(`errors.${visibleError}` as const)}
          </AlertDescription>
        </Alert>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@firm.com"
            required
            aria-invalid={Boolean(state?.fieldErrors?.email)}
          />
          {state?.fieldErrors?.email && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.email}` as const)}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("forgot_link")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
          />
          {state?.fieldErrors?.password && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.password}` as const)}
            </p>
          )}
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            name="remember_me"
            defaultChecked
            className="mt-0.5 size-4 rounded border-input text-accent focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-sm leading-snug">
            {t("remember_me")}
            <span className="block text-xs text-muted-foreground mt-0.5">
              {t("remember_me_hint")}
            </span>
          </span>
        </label>
        <Button
          type="submit"
          size="lg"
          className="w-full mt-2"
          disabled={pending}
        >
          {pending ? tc("loading") : t("submit_login")}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("no_account")}{" "}
        <Link
          href="/signup"
          className="text-foreground font-medium hover:underline underline-offset-4"
        >
          {t("create_account")}
        </Link>
      </p>
    </div>
  );
}
