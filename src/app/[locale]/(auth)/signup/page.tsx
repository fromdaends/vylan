"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signupAction, type AuthActionState } from "@/app/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { ArrowRight } from "lucide-react";

export default function SignupPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const localeNarrow: "fr" | "en" = locale === "en" ? "en" : "fr";
  // `?continue=onboarding` is a soft signal that the user already
  // qualified via /demo, so we can skip routing them back there after
  // signup. Validated allowlist-style server-side in signupAction so
  // random ?continue=anything values can't bypass the funnel.
  const searchParams = useSearchParams();
  const continueParam = searchParams.get("continue") ?? "";
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(signupAction, null);

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("signup_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("signup_subtitle")}
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

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="continue" value={continueParam} />
        {state?.error && (
          <Alert variant="destructive" className="animate-in-fade">
            <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            required
            aria-invalid={Boolean(state?.fieldErrors?.name)}
          />
          {state?.fieldErrors?.name && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.name}` as const)}
            </p>
          )}
        </div>
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
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
          />
          {state?.fieldErrors?.password && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.password}` as const)}
            </p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full mt-2"
          disabled={pending}
        >
          {pending ? tc("loading") : t("submit_signup")}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("have_account")}{" "}
        <Link
          href="/login"
          className="text-foreground font-medium hover:underline underline-offset-4"
        >
          {t("sign_in")}
        </Link>
      </p>
    </div>
  );
}
